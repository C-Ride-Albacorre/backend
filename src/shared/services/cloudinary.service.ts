
import { Injectable, BadRequestException } from "@nestjs/common";
import { UploadApiErrorResponse, UploadApiResponse, v2 } from "cloudinary";
import toStream = require("buffer-to-stream");

@Injectable()
export class CloudinaryService {
  async uploadLogo(
    fileName: Express.Multer.File,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    if (!fileName) {
      throw new BadRequestException('No file uploaded');
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

  // async uploadFile(filePath: string): Promise<string> {
  //   return new Promise((resolve, reject) => {
  //     v2.uploader.upload(filePath, (error, result) => {
  //       if (error) {
  //         reject(error);
  //       } else {
  //         resolve(result.secure_url);
  //       }
  //     });
  //   });
  // }

  async uploadFile(
    file: Express.Multer.File,
  ): Promise<{ rawUrl: string; viewableUrl: string }> {
    if (!file) throw new BadRequestException('No file uploaded');

    const isPdf = file.mimetype === 'application/pdf';

    return new Promise(async (resolve, reject) => {
      const uploadStream = v2.uploader.upload_stream(
        {
          folder: 'menu_uploads',
          use_filename: true,
          unique_filename: false,
          resource_type: 'auto',
          type: 'upload',
        },
        async (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));

          try {
            await v2.api.update(result.public_id, {
              access_mode: 'public',
            });
          } catch (err) {
            console.warn(
              '⚠️ Could not set access_mode to public:',
              err.message,
            );
          }

          const rawUrl = result.secure_url;
          const viewableUrl = isPdf
            ? rawUrl.replace('/upload/', '/upload/fl_inline/') // ✅ Only for display
            : rawUrl;

          resolve({ rawUrl, viewableUrl });
        },
      );

      toStream(file.buffer).pipe(uploadStream);
    });
  }
}
