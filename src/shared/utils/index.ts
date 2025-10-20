

export interface paginationQuery {
  q?: string;
  search?: string;
  pageNumber?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  startDate?: string;
  endDate?: string;
  read?: boolean;
}
export function capitalizeFirstLetter(str: string): string {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}




