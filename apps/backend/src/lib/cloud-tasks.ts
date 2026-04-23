import { CloudTasksClient } from '@google-cloud/tasks';
import { env } from './env';

export const cloudTasksClient: any = new CloudTasksClient();

const projectId = env.GOOGLE_CLOUD_PROJECT || 'college-bus-system-dev';
const queueName = env.CLOUD_TASKS_QUEUE;
const location = env.CLOUD_TASKS_LOCATION;

export const queuePath = cloudTasksClient.queuePath(projectId, location, queueName);
export const BACKEND_URL = env.BACKEND_URL;
