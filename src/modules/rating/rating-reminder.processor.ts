// rating-reminder.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RatingService } from './rating.service';

@Processor('rating-reminders')
export class RatingReminderProcessor extends WorkerHost {
  constructor(private ratingService: RatingService) {
    super();
  }

  async process(job: Job<{ ratingId: string }>): Promise<void> {
    await this.ratingService.processReminder(job);
  }
}