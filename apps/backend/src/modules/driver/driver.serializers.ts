type DriverAssignmentRecord = {
  id: string;
  busId: string;
  routeId: string;
  type: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  bus: {
    number: string;
  } | null;
  route: {
    name: string;
  } | null;
};

export const serializeDriverAssignment = (
  trip: DriverAssignmentRecord,
  scheduledDeparture: string | null,
  expectedStudents: number,
) => ({
  trip: {
    id: trip.id,
    busId: trip.busId,
    routeId: trip.routeId,
    type: trip.type,
    status: trip.status,
    scheduledDeparture,
    minutesLate: 0,
  },
  bus: trip.bus
    ? {
        number: trip.bus.number,
      }
    : null,
  route: trip.route
    ? {
        name: trip.route.name,
      }
    : null,
  expectedStudents,
});

export type SerializedDriverAssignment = ReturnType<typeof serializeDriverAssignment>;
