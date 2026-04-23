type RouteStopRecord = {
  id: string;
  stopId: string;
  sequence: number;
  scheduledTimeMorning: number;
  scheduledTimeReturn: number;
  isActive: boolean;
  stop: {
    id: string;
    name: string;
    lat: number;
    lon: number;
  };
};

type RouteRecord = {
  id: string;
  name: string;
  area: string;
  isActive: boolean;
  updatedAt: Date;
  activeDays?: string[];
  stops: RouteStopRecord[];
};

type StopRecord = {
  id: string;
  name: string;
  area: string | null;
  lat: number;
  lon: number;
  isActive: boolean;
};

export const serializeRoute = (route: RouteRecord) => ({
  id: route.id,
  name: route.name,
  area: route.area,
  isActive: route.isActive,
  updatedAt: route.updatedAt.toISOString(),
  activeDays: route.activeDays ?? [],
  stops: route.stops.map((stop) => ({
    id: stop.id,
    stopId: stop.stopId,
    sequence: stop.sequence,
    scheduledTimeMorning: stop.scheduledTimeMorning,
    scheduledTimeReturn: stop.scheduledTimeReturn,
    isActive: stop.isActive,
    stop: {
      id: stop.stop.id,
      name: stop.stop.name,
      lat: stop.stop.lat,
      lon: stop.stop.lon,
    },
  })),
});

export type SerializedRoute = ReturnType<typeof serializeRoute>;

export const serializeStopCatalogItem = (stop: StopRecord) => ({
  id: stop.id,
  name: stop.name,
  area: stop.area,
  lat: stop.lat,
  lon: stop.lon,
  isActive: stop.isActive,
});

export type SerializedStopCatalogItem = ReturnType<typeof serializeStopCatalogItem>;
