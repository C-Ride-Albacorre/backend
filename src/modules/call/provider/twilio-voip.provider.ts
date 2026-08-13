// // twilio-voip.provider.ts
// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import * as twilio from 'twilio';

// @Injectable()
// export class TwilioVoipProvider implements IVoipProvider {
//   private client: twilio.Twilio;
//   private twilioAccountSid: string;
//   private twilioApiKey: string;
//   private twilioApiSecret: string;

//   constructor(private config: ConfigService) {
//     this.twilioAccountSid = this.config.get('TWILIO_ACCOUNT_SID');
//     this.twilioApiKey = this.config.get('TWILIO_API_KEY');
//     this.twilioApiSecret = this.config.get('TWILIO_API_SECRET');
//     this.client = twilio(this.twilioApiKey, this.twilioApiSecret, {
//       accountSid: this.twilioAccountSid,
//     });
//   }

//   async generateToken(userId: string, roomName: string): Promise<string> {
//     // Use Twilio Access Token for Video or Voice
//     const AccessToken = twilio.jwt.AccessToken;
//     const VideoGrant = AccessToken.VideoGrant; // or VoiceGrant

//     const token = new AccessToken(
//       this.twilioAccountSid,
//       this.twilioApiKey,
//       this.twilioApiSecret,
//       { identity: userId },
//     );
//     const videoGrant = new VideoGrant({ room: roomName });
//     token.addGrant(videoGrant);
//     return token.toJwt();
//   }
// }