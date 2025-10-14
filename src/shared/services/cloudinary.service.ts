
import { Injectable, BadRequestException } from "@nestjs/common";
import { UploadApiErrorResponse, UploadApiResponse, v2 } from "cloudinary";
import toStream = require("buffer-to-stream");

@Injectable()
export class CloudinaryService {
  async uploadLogo(
    fileName: Express.Multer.File
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    if (!fileName) {
      throw new BadRequestException("No file uploaded");
    }
    return new Promise((resolve, reject) => {
      v2.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const upload = v2.uploader.upload_stream((error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      toStream(fileName.buffer).pipe(upload);
    });
  }

  async uploadFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      v2.uploader.upload(filePath, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result.secure_url);
        }
      });
    });
  }


  
}
