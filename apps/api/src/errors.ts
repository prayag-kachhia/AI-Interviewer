export class NotFoundError extends Error {
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
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
