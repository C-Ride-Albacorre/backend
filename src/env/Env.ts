import dotEnv from "dotenv";
dotEnv.config();

class Env {
  static USER_EMAIL = process.env.USER_EMAIL;
  static APP_PASSWORD = process.env.APP_PASSWORD;
  static SESSION_SECRET = process.env.SESSION_SECRET;
  static NODE_ENV = process.env.NODE_ENV;

  static PORT = process.env.NODE_ENV === "" ? 0 : process.env.PORT ;

  static JWT_SECRET = process.env.JWT_SECRET ;
  static JWT_TOKEN_EXPIRATION = process.env.JWT_TOKEN_EXPIRATION ;
  static GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
  static GOOGLE_MAPS_DIRECTION_API = process.env.GOOGLE_MAPS_DRIECTION_API || "";
  static GOOGLE_AUTH_REDIRECT_URL = process.env.GOOGLE_AUTH_REDIRECT_URL;
  static FRONT_END_BASE_URL = process.env.FRONT_END_BASE_URL;

  static GEOPIFY_API = process.env.GEOPIFY_API;
  static ENC_SEC_KEY = process.env.ENC_SEC_KEY;

  static Redis = {
    url: this.NODE_ENV === "" ? "" : process.env.REDIS_URL,
  };
  static AWS = {
    AWS_ACCESS_KEY: process.env.AWS_ACCESS_KEY,
    AWS_SECRET_KEY: process.env.AWS_SECRET_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_REGION: process.env.AWS_S3_REGION,
    AWS_DOCS_BUCKET: process.env.AWS_DOCS_BUCKET,
  };
  static KAFKA = {
    KAFKA_HOST: this.NODE_ENV === "" ? "" : process.env.KAFKA_HOST,
    KAFKA_USER_NAME: process.env.KAFKA_USER_NAME,
    KAFKA_PASSWORD: process.env.KAFKA_PASSWORD,
    KAFKA_PEM: process.env.KAFKA_PEM,
  };

  static MISC = {
    MAX_DOC_UPLOAD_FILE_SIZE: process.env.MAX_DOC_UPLOAD_FILE_SIZE,
  };

  static DATABASE = {
    URI: process.env.DB_URI || "",
    RETRIES: process.env.DB_CONN_RETIRE,
    DB_DATA: {
      NAME: "test",
      COLLECTIONS: {
        USER: "user",
        TEMP_EMAIL_LINK: "temp_email_link",
        AUTH_OTP: "auth_otp",
        ORGANIZATION: "organization",
        SUPERADMIN: "superadmin",
        VEHICLE: "vehicle",
        DRIVER: "driver",
        RIDE: "ride",
        FLEET: "fleet",
        ZONE: "zone",
        NONE_ZONE: "noneZone",
        TOKEN: "token",
        VEHICLE_CATEGORY: "vehicle_Category",
        AVAILABLE_OPTIONS: "available_options",
        DRIVER_INVITATION: "driver_invitation",
        DOCUMENT: "document",
        RIDE_OTP: "ride_otp",
        EMERGENCY_CONTACT: "emergency_contact",
        REGISTRATION_TOKEN: "registration_token",
        PAYMENT: "payment",
        FARE: "fare",
        USER_SAVED_LOCATION: "usersavedlocation",
        DATED_MESSAGES: "datedmessage",
        MESSAGE: "message",
        CHAT: "chat",
        INTRACITY_RIDE: "intracity_ride",
        INTRACITY_RIDE_PASSENGER: "intracity_ride_passenger",
        REGISTERED_CITIES: "registered_cities",
        PACKAGE_RIDE: "packages_ride",
        PACKAGE: "package",
        USER_SAVED_RIDER: "user_rider",
        RATING: "rating",
        RIDE_REQUEST: "ride_request",
        FILE_APPROVAL: "file_approval",
        VEHICLE_FILE_APPROVAL: "vehicle_file_approval",
        VEHICLE_SERVICE_APPROVAL: "vehicle_service_approval",
        JUMPSTART_RIDE: "jumpstart_ride",
        LISTING: "listing",
        JUMPSTART_CONNECTION: "jumpstart_connection",
        FUEL_CARD: "fuel_card",
        FUEL_PARTNER: "fuel_partner"
      },
    },
  };
  static STRIPE = {
    PK: process.env.STRIPE_PK as string,
    SK: process.env.STRIPE_SK as string,
  };
}

export default Env;
