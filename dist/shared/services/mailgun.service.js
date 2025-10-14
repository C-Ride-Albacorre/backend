"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailGunService = void 0;
const common_1 = require("@nestjs/common");
const Handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");
const mailgun_js_1 = require("mailgun-js");
const prisma_service_1 = require("./prisma.service");
let MailGunService = class MailGunService {
    constructor(prisma) {
        this.prisma = prisma;
        this.mailgun = (0, mailgun_js_1.default)({
            apiKey: `${process.env.MAILGUN_API_KEY}`,
            domain: `${process.env.MAILGUN_DOMAIN}`,
        });
    }
    async sendEmail(to, subject, html) {
        const data = {
            from: `Incite360 - ${process.env.DEFAULT_MAILER}`,
            to,
            subject,
            html,
        };
        return this.mailgun.messages().send(data);
    }
    async sendEmailWithTemplate(arg) {
        const template = this.loadTemplate(arg.templateName);
        const html = this.renderTemplate(template, arg.context);
        const data = {
            from: `Incite360 - ${process.env.DEFAULT_MAILER}`,
            to: arg.to,
            subject: arg.subject,
            html,
        };
        return this.mailgun.messages().send(data);
    }
    loadTemplate(templateName) {
        const templateDir = path.join(__dirname, "..", "..", "..", "..", "dist", "views", "mailer");
        const templatePath = path.join(templateDir, `${templateName}.hbs`);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template not found: ${templatePath}`);
        }
        return fs.readFileSync(templatePath, "utf-8");
    }
    renderTemplate(template, context) {
        const compiledTemplate = Handlebars.compile(template);
        return compiledTemplate(context);
    }
};
exports.MailGunService = MailGunService;
exports.MailGunService = MailGunService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MailGunService);
//# sourceMappingURL=mailgun.service.js.map