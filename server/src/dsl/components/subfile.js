// Subfile Component
// Scrollable list with column headers and data rows
/**
 * Create a subfile (scrollable list) element
 *
 * Example:
 * ```
 * subfile('customers', 6, 12, [
 *   { header: 'Opt', field: 'opt', width: 3, type: 'alpha' },
 *   { header: 'Cust #', key: 'id', width: 10 },
 *   { header: 'Name', key: 'name', width: 30 },
 *   { header: 'City', key: 'city', width: 20 },
 * ])
 * ```
 *
 * @param name - Data key in context for the records array
 * @param startRow - Row where the subfile header begins
 * @param pageSize - Number of data rows to display
 * @param columns - Column definitions
 * @param options - Additional options
 */
export function subfile(name, startRow, pageSize, columns, options = {}) {
    return {
        kind: 'subfile',
        name,
        startRow,
        pageSize,
        columns,
        showMore: options.showMore ?? true,
    };
}
/**
 * Render subfile element
 * Returns header row, data rows, and input field definitions
 */
export function renderSubfile(element, context, pageOffset = 0) {
    const textRows = [];
    const fields = [];
    // Get data from context
    const data = context[element.name] || [];
    const pageData = data.slice(pageOffset, pageOffset + element.pageSize);
    const hasMore = data.length > pageOffset + element.pageSize;
    // Build header row
    let headerContent = '';
    let currentCol = 0;
    const columnPositions = [];
    element.columns.forEach((col, index) => {
        columnPositions.push({ col: currentCol, width: col.width });
        // Add column header (centered or left-aligned based on type)
        let headerText = col.header;
        if (col.align === 'center') {
            const padding = Math.floor((col.width - headerText.length) / 2);
            headerText = ' '.repeat(padding) + headerText;
        }
        else if (col.align === 'right') {
            headerText = headerText.padStart(col.width);
        }
        headerText = headerText.slice(0, col.width).padEnd(col.width);
        headerContent += headerText;
        // Add separator between columns
        if (index < element.columns.length - 1) {
            headerContent += ' ';
            currentCol += col.width + 1;
        }
        else {
            currentCol += col.width;
        }
    });
    // Add header row
    textRows.push({
        row: element.startRow,
        col: 0,
        content: headerContent,
    });
    // Add underline below header
    textRows.push({
        row: element.startRow + 1,
        col: 0,
        content: '-'.repeat(Math.min(80, currentCol)),
    });
    // Render data rows
    pageData.forEach((record, rowIndex) => {
        const dataRow = element.startRow + 2 + rowIndex;
        let rowContent = '';
        let colOffset = 0;
        element.columns.forEach((col, colIndex) => {
            if (col.field) {
                // This is an input field column (like 'opt')
                const fieldPlaceholder = '_'.repeat(col.width);
                rowContent += fieldPlaceholder;
                // Add field definition
                fields.push({
                    row: dataRow,
                    col: colOffset,
                    length: col.width,
                    type: col.type || 'alpha',
                    name: `${col.field}_${rowIndex}`, // Unique name per row
                });
            }
            else if (col.key) {
                // This is a display column
                let value = String(record[col.key] ?? '');
                if (col.align === 'right') {
                    value = value.padStart(col.width);
                }
                else if (col.align === 'center') {
                    const padding = Math.floor((col.width - value.length) / 2);
                    value = ' '.repeat(padding) + value;
                }
                value = value.slice(0, col.width).padEnd(col.width);
                rowContent += value;
            }
            // Add separator between columns
            if (colIndex < element.columns.length - 1) {
                rowContent += ' ';
                colOffset += col.width + 1;
            }
            else {
                colOffset += col.width;
            }
        });
        textRows.push({
            row: dataRow,
            col: 0,
            content: rowContent,
        });
    });
    // Fill remaining rows with blanks (to maintain consistent display)
    for (let i = pageData.length; i < element.pageSize; i++) {
        const emptyRow = element.startRow + 2 + i;
        textRows.push({
            row: emptyRow,
            col: 0,
            content: ' '.repeat(currentCol),
        });
    }
    // Add "More..." indicator if there are more records
    if (element.showMore && hasMore) {
        const moreRow = element.startRow + element.pageSize + 2;
        textRows.push({
            row: moreRow,
            col: 70,
            content: 'More...',
        });
    }
    return { textRows, fields, hasMore };
}
/**
 * Get the first input field name from a subfile (for default cursor)
 */
export function getFirstSubfileField(element) {
    const inputCol = element.columns.find(col => col.field);
    return inputCol ? `${inputCol.field}_0` : undefined;
}
