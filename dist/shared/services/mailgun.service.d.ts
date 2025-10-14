import { PrismaService } from "./prisma.service";
export declare class MailGunService {
    private readonly prisma;
    private mailgun;
    constructor(prisma: PrismaService);
    sendEmail(to: string, subject: string, html: string): Promise<any>;
    sendEmailWithTemplate(arg: {
        to: string;
        subject: string;
        templateName: string;
        context: object;
    }): Promise<any>;
    private loadTemplate;
    private renderTemplate;
}
