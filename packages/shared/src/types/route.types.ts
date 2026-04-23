export interface Stop {
  id: string;
  name: string;
  area: string | null;
  lat: number;
  lon: number;
  isActive: boolean;
}

export interface RouteStop {
  id: string;
  stopId: string;
  sequence: number;
  scheduledTimeMorning: number;
  scheduledTimeReturn: number;
  isActive: boolean;
  stop: Stop;
}

export interface Route {
  id: string;
  name: string;
  area: string;
  isActive: boolean;
  updatedAt: string;
  activeDays?: string[];
  stops?: RouteStop[];
}
