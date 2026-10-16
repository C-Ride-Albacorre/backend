// rating-reminder.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RatingService } from './rating.service';
import { QUEUES } from '../../shared/constants';

// @Processor('rating-reminders')
@Processor(QUEUES.RATING_REMINDERS)
export class RatingReminderProcessor extends WorkerHost {
  constructor(private ratingService: RatingService) {
    super();
  }

  async process(job: Job<{ ratingId: string }>): Promise<void> {
    await this.ratingService.processReminder(job);
  }
}