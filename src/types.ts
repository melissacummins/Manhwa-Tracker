export interface Manhwa {
  id: string;
  title: string;
  alternativeTitles: string[];
  status: string;
  isFavorite: boolean;
  notes: string;
  createdAt: any;
  updatedAt: any;
  userId: string;
}

export interface UserSettings {
  statusConfig: Record<string, string>;
  userId: string;
}

export const DEFAULT_STATUSES = {
  'Reading': '#3b82f6', // Blue
  'Completed': '#10b981', // Emerald
  'On Hold': '#f59e0b', // Amber
  'Dropped': '#ef4444', // Red
  'Plan to Read': '#6366f1', // Indigo
};
