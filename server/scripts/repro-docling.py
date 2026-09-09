"""Reproduce an as500-docs VlmPipeline failure and print the exception Docling hides.

`docling/pipeline/base_pipeline.py` raises `RuntimeError("Pipeline X failed") from e`
and never logs `e`; as500-docs then stores only `str(exc)`. So the stored job error
says nothing about what actually broke. This runs the same conversion and prints the
full `__cause__` chain.

Run inside the as500-docs worker container:
    docker cp repro-docling.py as500-docs-worker-1:/tmp/
    docker exec as500-docs-worker-1 python /tmp/repro-docling.py <pdf-path> [max_pages]
"""

import sys
import traceback
from pathlib import Path

pdf = Path(sys.argv[1])
max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 0

print(f"pdf         {pdf}")
print(f"exists      {pdf.exists()}  size={pdf.stat().st_size if pdf.exists() else '-'}")

from docling.datamodel import vlm_model_specs
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import VlmPipelineOptions
from docling.datamodel.settings import settings as docling_settings
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.pipeline.vlm_pipeline import VlmPipeline

from as500_docs.config import settings

# Page count first — a 200-page guide behaves very differently from a 2-page one.
try:
    from pypdfium2 import PdfDocument

    with PdfDocument(str(pdf)) as d:
        print(f"pages       {len(d)}")
except Exception as exc:  # noqa: BLE001
    print(f"pages       (could not read: {exc})")

vlm_options = vlm_model_specs.GRANITEDOCLING_VLLM_API
vlm_options.url = f"{settings.VLM_API_URL}/chat/completions"
vlm_options.concurrency = settings.DOCLING_CONCURRENCY
docling_settings.perf.page_batch_size = settings.DOCLING_CONCURRENCY
vlm_options.params["skip_special_tokens"] = False
vlm_options.params["temperature"] = 0.0
vlm_options.params["max_tokens"] = 2048

print(f"vlm url     {vlm_options.url}")
print(f"concurrency {vlm_options.concurrency}")
print(f"max_pages   {max_pages or 'all'}")
print("-" * 72)

converter = DocumentConverter(
    format_options={
        InputFormat.PDF: PdfFormatOption(
            pipeline_cls=VlmPipeline,
            pipeline_options=VlmPipelineOptions(
                vlm_options=vlm_options, enable_remote_services=True
            ),
        )
    }
)

kwargs = {}
if max_pages:
    kwargs["page_range"] = (1, max_pages)

try:
    result = converter.convert(str(pdf), **kwargs)
    doc = result.document
    print(f"OK status={result.status} pages={len(doc.pages)} texts={len(doc.texts)}")
    print(f"markdown chars={len(doc.export_to_markdown())}")
except Exception as exc:  # noqa: BLE001
    print(f"FAILED {type(exc).__name__}: {exc}\n")
    depth = 0
    cause = exc.__cause__ or exc.__context__
    while cause is not None and depth < 6:
        depth += 1
        print(f"── cause #{depth}: {type(cause).__module__}.{type(cause).__name__}")
        print(f"   {cause}")
        # Response bodies carry the real vLLM rejection reason.
        for attr in ("response", "request", "status_code"):
            value = getattr(cause, attr, None)
            if value is not None:
                print(f"   .{attr} = {value!r}")
                body = getattr(value, "text", None)
                if body:
                    print(f"   .{attr}.text = {body[:800]}")
        print("".join(traceback.format_tb(cause.__traceback__))[-2500:])
        cause = cause.__cause__ or cause.__context__
