"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
exports.capitalizeFirstLetter = capitalizeFirstLetter;
const common_1 = require("@nestjs/common");
function capitalizeFirstLetter(str) {
    return str
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
class Utils {
    constructor(prisma, jwtService, mailGunService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.mailGunService = mailGunService;
    }
    static response(data) {
        return {
            message: "data fetched",
            success: true,
            data: null,
            meta: null,
            ...data,
        };
    }
    static unixTimestamp() {
        return Math.floor(Date.now() / 100);
    }
    static checkEntityExists(entity, id, entityName) {
        if (!entity) {
            throw new common_1.NotFoundException(`${entityName} with id ${id} not found`);
        }
        return entity;
    }
    static generateListName() {
        const prefix = 'AL_';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomPart = '';
        for (let i = 0; i < 7; i++) {
            randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return prefix + randomPart;
    }
}
exports.Utils = Utils;
//# sourceMappingURL=index.js.map