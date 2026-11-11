export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(404, message);
  }
}

export async function getUserResourceOr404<T>(
  query: Promise<T | null>
): Promise<T> {
  const resource = await query;

  if (!resource) {
    throw new NotFoundError();
  }

  return resource;
}
