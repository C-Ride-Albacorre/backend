import { Controller, Get, Head } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags } from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiTags("Hey! Wasup, Let's roll...")
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Head()
  headHello(): void {
    // Return nothing; 200 OK
  }
}
