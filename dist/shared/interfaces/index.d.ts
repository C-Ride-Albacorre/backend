export interface ResponseData {
    message?: string;
    success?: boolean;
    data?: object | null;
    meta?: object | null;
}
export interface PageParams {
    q?: string;
    search?: string;
    pageNumber?: number | 1;
    pageSize?: number | 10;
    sortBy?: string | "id";
    sortDir?: string | "desc";
    startDate?: string;
    endDate?: string;
    endCursor?: string;
}
export interface PagedResponse {
    meta?: object | null;
    data?: object | null;
}
