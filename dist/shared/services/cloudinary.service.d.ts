import { UploadApiErrorResponse, UploadApiResponse } from "cloudinary";
export declare class CloudinaryService {
    uploadLogo(fileName: Express.Multer.File): Promise<UploadApiResponse | UploadApiErrorResponse>;
    uploadFile(filePath: string): Promise<string>;
}
