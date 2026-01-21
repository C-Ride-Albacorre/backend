import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from './prisma.service';

@Injectable()
export class MailGunService {
  private mailClient: any;
  private logger = new Logger(MailGunService.name);

  constructor(private readonly prisma: PrismaService) {
    try {
      // ==============================
      // Try new official SDK (mailgun.js)
      // ==============================
      const Mailgun = require('mailgun.js');
      const formData = require('form-data');
      const mailgun = new Mailgun(formData);

      this.mailClient = mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY!,
      });

      this.logger.log('✅ Using new Mailgun SDK (mailgun.js)');
    } catch {
      // ==============================
      // Fallback to legacy SDK (mailgun-js)
      // ==============================
      const mailgun = require('mailgun-js');
      this.mailClient = mailgun({
        apiKey: process.env.MAILGUN_API_KEY!,
        domain: process.env.MAILGUN_DOMAIN!,
      });

      this.logger.warn('⚠️ Using legacy Mailgun SDK (mailgun-js)');
    }
  }

  // ==============================
  // Send plain email
  // ==============================
  async sendEmail(to: string, subject: string, html: string) {
    const data = {
      from: `${process.env.APP_NAME || 'C-Ride'} - ${process.env.DEFAULT_MAILER}`,
      to,
      subject,
      html,
    };

    // Detect which SDK is active
    if (this.mailClient.messages && this.mailClient.messages.create) {
      // New mailgun.js syntax
      return this.mailClient.messages.create(process.env.MAILGUN_DOMAIN!, data);
    } else if (this.mailClient.messages && this.mailClient.messages().send) {
      // Old mailgun-js syntax
      return this.mailClient.messages().send(data);
    } else {
      throw new Error('No valid Mailgun client initialized.');
    }
  }

  private registerPartials() {
    const srcDir = path.join(process.cwd(), 'src', 'views', 'partials');
    const distDir = path.join(__dirname, '..', '..', 'views', 'partials');
    const partialsDir = fs.existsSync(srcDir) ? srcDir : distDir;

    if (fs.existsSync(partialsDir)) {
      const files = fs.readdirSync(partialsDir);
      files.forEach((file) => {
        const match = /(.+)\.hbs$/.exec(file);
        if (match) {
          const name = match[1];
          const filePath = path.join(partialsDir, file);
          const template = fs.readFileSync(filePath, 'utf8');
          Handlebars.registerPartial(name, template);
        }
      });
      this.logger.log(
        `✅ Registered ${files.length} mail partials from ${partialsDir}`,
      );
    } else {
      this.logger.warn(`⚠️ No partials directory found in ${partialsDir}`);
    }
  }

  // ==============================
  // Send email using Handlebars template
  // ==============================
  async sendEmailWithTemplate(arg: {
    to: string;
    subject: string;
    templateName: string;
    context: object;
  }) {
    //  Register partials first
    this.registerPartials();

    const template = this.loadTemplate(arg.templateName);
    const html = this.renderTemplate(template, arg.context);

    const data = {
      from: `${process.env.APP_NAME || 'C-Ride'} - ${process.env.DEFAULT_MAILER}`,
      to: arg.to,
      subject: arg.subject,
      html,
    };

    if (this.mailClient.messages && this.mailClient.messages.create) {
      return this.mailClient.messages.create(process.env.MAILGUN_DOMAIN!, data);
    } else if (this.mailClient.messages && this.mailClient.messages().send) {
      return this.mailClient.messages().send(data);
    } else {
      throw new Error('No valid Mailgun client initialized.');
    }
  }

  // ==============================
  // Load Handlebars template
  // ==============================

  private loadTemplate(templateName: string): string {
    // Use process.cwd() to get the root of the project (not dist)
    const templateDir = path.join(process.cwd(), 'src', 'views', 'mailer');
    const templatePath = path.join(templateDir, `${templateName}.hbs`);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    return fs.readFileSync(templatePath, 'utf-8');
  }

  // ==============================
  // Compile template
  // ==============================
  private renderTemplate(template: string, context: object): string {
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(context);
  }
}
