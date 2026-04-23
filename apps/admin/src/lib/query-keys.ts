export const QK = {
  // Live ops
  dashboard:      ()                => ['live', 'dashboard']           as const,
  commandCenter:  ()                => ['live', 'command-center']      as const,
  activeTrips:    ()                => ['live', 'trips', 'active']     as const,
  alerts:         ()                => ['live', 'alerts']              as const,
  tripState:      (id: string)      => ['live', 'trips', id]           as const,

  // Operational
  corrections:    ()                => ['ops', 'corrections']          as const,
  incidents:      (status?: string) => ['ops', 'incidents', status]    as const,
  gpsOutages:     ()                => ['ops', 'gps-outages']          as const,
  messages:       (busId?: string)  => ['ops', 'messages', busId]      as const,
  auditLog:       (params: object)  => ['ops', 'audit-log', params]    as const,

  // Data
  students:       (params: object)  => ['data', 'students', params]    as const,
  routes:         ()                => ['data', 'routes']              as const,
  route:          (id: string)      => ['data', 'routes', id]          as const,
  buses:          ()                => ['data', 'fleet', 'buses']      as const,
  drivers:        ()                => ['data', 'fleet', 'drivers']    as const,

  // Reports
  reportStatus:   (jobId: string)   => ['reports', jobId, 'status']    as const,
  reportOverview: (params: object)  => ['reports', 'overview', params] as const,
} as const;
