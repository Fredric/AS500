import axios from "axios";

export interface jiraTask {
    id: string;
    name: string;
    description: string;
    status: string;
    assignee: string;
  }

const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? '';
const EMAIL = process.env.JIRA_USER_EMAIL ?? '';
const API_TOKEN = process.env.JIRA_API_TOKEN ?? '';

const jira = axios.create({
    baseURL: JIRA_BASE_URL,
    auth: {
      username: EMAIL,
      password: API_TOKEN

    },
    headers: {
      Accept: 'application/json',
    },
  });
  
  export async function getJiraTasks(): Promise<jiraTask[]> {
    const jql = "assignee = currentUser() AND (status != Done OR resolution != Done) ORDER BY created DESC"
    const response = await jira.get('/rest/api/3/search/jql', {
      params: {
        jql,
        maxResults: 25,
        includeCollapsedFields: true,
        fields: "key,summary,status,assignee"
      }
    });
    
    const data = response.data.issues.map((issue: any) => ({
      id: issue.key,
      name: issue.fields.summary,
      status: issue.fields.status.name,
      assignee: issue.fields.assignee.displayName
    }));
    
    return data;
  }

