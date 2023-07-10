export function isNodeError(error: any): error is NodeJS.ErrnoException { return error instanceof Error; }
