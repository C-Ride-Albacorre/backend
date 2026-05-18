export class ApproveDispatcherDto {
  action: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  rejectionReason?: string;
}
