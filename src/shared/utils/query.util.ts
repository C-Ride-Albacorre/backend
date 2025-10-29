import { Prisma } from '@prisma/client';

interface QueryOptions {
  skip?: number;
  take?: number;
  search?: string | null;
  searchFields?: string[];
  filters?: Record<string, any>;
}

/**
 * Builds a safe Prisma "findMany" query object with pagination, filtering, and search.
 */
export function buildQuery<T>(options: QueryOptions): {
  skip: number;
  take: number;
  where: T;
  orderBy: Record<string, 'asc' | 'desc'>;
} {
  const {
    skip = 0,
    take = 20,
    search,
    searchFields = [],
    filters = {},
  } = options;

  // 🧹 Remove filters with null/undefined/empty string
  const cleanedFilters = Object.fromEntries(
    Object.entries(filters).filter(
      ([_, value]) => value !== null && value !== undefined && value !== '',
    ),
  );

  // 🔍 Build safe search conditions (ignore if search is empty)
  const searchCondition =
    search && search.trim().length > 0 && searchFields.length > 0
      ? {
          OR: searchFields.filter(Boolean).map((field) => ({
            [field]: {
              contains: search.trim(),
              mode: 'insensitive',
            },
          })),
        }
      : {};

  // ✅ Return consistent Prisma query object
  return {
    skip,
    take,
    where: {
      AND: [cleanedFilters, searchCondition],
    } as T,
    orderBy: { createdAt: 'desc' },
  };
}
