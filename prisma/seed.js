"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const enums_1 = require("../src/shared/enums");
const dotenv = require("dotenv");
const helpers_1 = require("../src/shared/utils/helpers");
dotenv.config();
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding database...');
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const email = process.env.SUPER_ADMIN_EMAIL;
    if (!password) {
        throw new Error('SUPER_ADMIN_PASSWORD not found in env');
    }
    const hashedPassword = await helpers_1.default.hashText(password);
    const superAdmin = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
            email,
            firstName: process.env.SUPER_ADMIN_FIRSTNAME,
            lastName: process.env.SUPER_ADMIN_LASTNAME,
            password: hashedPassword,
            role: enums_1.UserRole.SUPER_ADMIN,
            isActive: true,
            isVerified: true,
            isEmailVerified: true,
            isPhoneVerified: true,
            verifiedAt: new Date(),
        },
    });
    console.log('Super admin ensured:', superAdmin.email);
}
main()
    .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map