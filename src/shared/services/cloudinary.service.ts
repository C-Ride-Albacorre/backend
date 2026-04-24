import { Injectable, BadRequestException } from '@nestjs/common';
import { UploadApiErrorResponse, UploadApiResponse, v2 } from 'cloudinary';
import toStream = require('buffer-to-stream');

@Injectable()
export class CloudinaryService {
  async uploadLogo(
    file: Express.Multer.File,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return new Promise((resolve, reject) => {
      const upload = v2.uploader.upload_stream(
        {
          resource_type: 'auto', // ✅ fix
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );

      toStream(file.buffer).pipe(upload);
    });
  }

  async uploadLogoBlockspng(
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

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{
    secure_url: string;
    public_id: string;
  }> {
    if (!file) throw new BadRequestException('No file uploaded');

    return new Promise((resolve, reject) => {
      const uploadStream = v2.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));

          resolve({
            secure_url: result.secure_url,
            public_id: result.public_id,
          });
        },
      );

      toStream(file.buffer).pipe(uploadStream);
    });
  }

  async uploadFilebk(
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

  // --- New Method for Multiple File Uploads ---
  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<{ secure_url: string; public_id: string }[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    // Use Promise.all to upload all files concurrently
    const uploadPromises = files.map((file) => this.uploadFile(file, folder));
    return Promise.all(uploadPromises);
  }

  /**
   * Upload a single document
   */
  // async uploadDocument(
  //   file: Express.Multer.File,
  //   folder = 'documents',
  // ): Promise<{
  //   secure_url: string;
  //   public_id: string;
  //   format: string;
  //   resource_type: string;
  //   bytes: number;
  //   created_at: string;
  // }> {
  //   if (!file) {
  //     throw new BadRequestException('No file uploaded');
  //   }

  //   return new Promise((resolve, reject) => {
  //     const uploadStream = v2.uploader.upload_stream(
  //       {
  //         folder,
  //         resource_type: 'auto',
  //         use_filename: true,
  //         unique_filename: true,
  //       },
  //       (error: UploadApiErrorResponse, result: UploadApiResponse) => {
  //         if (error) return reject(error);
  //         if (!result) return reject(new Error('Upload failed'));

  //         resolve({
  //           secure_url: result.secure_url,
  //           public_id: result.public_id,
  //           format: result.format,
  //           resource_type: result.resource_type,
  //           bytes: result.bytes,
  //           created_at: result.created_at,
  //         });
  //       },
  //     );

  //     toStream(file.buffer).pipe(uploadStream);
  //   });
  // }
  async uploadDocument(
    file: Express.Multer.File,
    options?: {
      folder?: string;
      resource_type?: 'auto' | 'image' | 'video' | 'raw';
      tags?: string[];
    },
  ): Promise<{
    secure_url: string;
    public_id: string;
    format: string;
    resource_type: string;
    bytes: number;
    created_at: string;
  }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = v2.uploader.upload_stream(
        {
          folder: options?.folder ?? 'documents',
          resource_type: options?.resource_type ?? 'auto',
          tags: options?.tags,
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));

          resolve({
            secure_url: result.secure_url,
            public_id: result.public_id,
            format: result.format,
            resource_type: result.resource_type,
            bytes: result.bytes,
            created_at: result.created_at,
          });
        },
      );

      toStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Upload multiple documents
   */
  async uploadMultipleDocuments(
    files: Express.Multer.File[],
    folder = 'documents',
  ): Promise<
    {
      secure_url: string;
      public_id: string;
      format: string;
      resource_type: string;
      bytes: number;
      created_at: string;
    }[]
  > {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const uploadPromises = files.map((file) =>
      this.uploadDocument(file, folder as any),
    );

    return Promise.all(uploadPromises);
  }

  /**
   * Delete document
   */
  async deleteDocument(publicId: string): Promise<boolean> {
    if (!publicId) {
      throw new BadRequestException('Public ID is required');
    }

    const result = await v2.uploader.destroy(publicId);
    return result.result === 'ok';
  }

  /**
   * Get document details
   */
  async getDocumentInfo(publicId: string) {
    if (!publicId) {
      throw new BadRequestException('Public ID is required');
    }

    return v2.api.resource(publicId);
  }
}
