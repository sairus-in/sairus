type BusAssignmentRecord = {
  route: {
    name: string;
  } | null;
  driver: {
    id: string;
    name: string;
    phone: string;
  } | null;
};

type BusRecord = {
  id: string;
  number: string;
  plateNumber: string;
  capacity: number;
  isActive: boolean;
  assignments?: BusAssignmentRecord[];
};

type DriverRecord = {
  id: string;
  name: string;
  phone: string;
  licenseNumber: string | null;
  isActive: boolean;
  createdAt: Date;
};

export const serializeBus = (bus: BusRecord) => ({
  id: bus.id,
  number: bus.number,
  plateNumber: bus.plateNumber,
  capacity: bus.capacity,
  isActive: bus.isActive,
  assignments: (bus.assignments ?? []).map((assignment) => ({
    route: assignment.route ? { name: assignment.route.name } : null,
    driver: assignment.driver
      ? {
          id: assignment.driver.id,
          name: assignment.driver.name,
          phone: assignment.driver.phone,
        }
      : null,
  })),
});

export type SerializedBus = ReturnType<typeof serializeBus>;

export const serializeDriver = (driver: DriverRecord) => ({
  id: driver.id,
  name: driver.name,
  phone: driver.phone,
  licenseNumber: driver.licenseNumber,
  isActive: driver.isActive,
  createdAt: driver.createdAt.toISOString(),
});

export type SerializedDriver = ReturnType<typeof serializeDriver>;
