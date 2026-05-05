import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Testing Deployment to staging'; //"All good! Let's get started";
  }
}
