declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TripId = Brand<string, 'TripId'>;
export type BusId = Brand<string, 'BusId'>;
export type StudentId = Brand<string, 'StudentId'>;
export type DriverId = Brand<string, 'DriverId'>;
export type RouteId = Brand<string, 'RouteId'>;
export type StopId = Brand<string, 'StopId'>;
export type AttendanceId = Brand<string, 'AttendanceId'>;
export type IncidentId = Brand<string, 'IncidentId'>;

export const TripId = (raw: string): TripId => raw as TripId;
export const BusId = (raw: string): BusId => raw as BusId;
export const StudentId = (raw: string): StudentId => raw as StudentId;
export const DriverId = (raw: string): DriverId => raw as DriverId;
export const RouteId = (raw: string): RouteId => raw as RouteId;
export const StopId = (raw: string): StopId => raw as StopId;
export const AttendanceId = (raw: string): AttendanceId => raw as AttendanceId;
export const IncidentId = (raw: string): IncidentId => raw as IncidentId;
