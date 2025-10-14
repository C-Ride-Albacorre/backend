import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import * as useragent from "express-useragent";

@Injectable()
export class UserAgentMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const source = req.headers["user-agent"] || "";
    const ua = useragent.parse(source);

    // Determine if the request is from a mobile device or a web browser
    req["deviceType"] = ua.isMobile ? "mobile" : "web";

    // You can log this information or save it in the database
   // console.log(`User accessed via ${req["deviceType"]}`);

    next();
  }
}
