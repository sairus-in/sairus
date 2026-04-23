export const createAxiosError = (
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) =>
  Object.assign(new Error(message), {
    isAxiosError: true,
    response: {
      status,
      data: {
        code,
        message,
        details,
      },
    },
  });
