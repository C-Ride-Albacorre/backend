// mail.service.ts
import { Injectable } from "@nestjs/common";
import * as Handlebars from "handlebars";
import * as fs from "fs";
import * as path from "path";
import mailgun from "mailgun-js";
import { PrismaService } from "./prisma.service";

@Injectable()
export class MailGunService {
  private mailgun;

  constructor(private readonly prisma: PrismaService) {
    this.mailgun = mailgun({
      apiKey: `${process.env.MAILGUN_API_KEY}`,
      domain: `${process.env.MAILGUN_DOMAIN}`,
    });
  }


  async sendEmail(to: string, subject: string, html: string) {
    const data = {
      from: `Incite360 - ${process.env.DEFAULT_MAILER}`,
      to,
      subject,
      html,
    };

    return this.mailgun.messages().send(data);
    //await this.mailgun.messages().send(data);
  }

  async sendEmailWithTemplate(arg: {
    to: string;
    subject: string;
    templateName: string;
    context: object;
  }) {
    const template = this.loadTemplate(arg.templateName);
    const html = this.renderTemplate(template, arg.context);

    const data = {
      from: `Incite360 - ${process.env.DEFAULT_MAILER}`,
      to: arg.to,
      subject: arg.subject,
      html,
    };

    return this.mailgun.messages().send(data);
    //await this.mailgun.messages().send(data);
  }


  private loadTemplate(templateName: string): string {
    // const templateDir =
    //   process.env.TEMPLATE_DIR ||
    //   path.resolve(__dirname, "../../../src/templates");

    const templateDir = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "dist",
      "views",
      "mailer",
    );

    //console.log(`Template directory: ${templateDir}`); // Log the template directory
    const templatePath = path.join(templateDir, `${templateName}.hbs`);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    //console.log(`Using template path: ${templatePath}`);
    return fs.readFileSync(templatePath, "utf-8");
  }

  private renderTemplate(template: string, context: object): string {
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(context);
  }
}
