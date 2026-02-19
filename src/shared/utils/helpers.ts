import axios from 'axios';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as Chance from 'chance';
import { DATE_TIME_OFFSET, DEFAULT_LIMIT, SortOrder } from './constant';
import { BadRequestException, Logger } from '@nestjs/common';
import levenshtein from 'fast-levenshtein';
import moment from 'moment';
import { FileFilterCallback } from 'multer';
import { User } from '@prisma/client';
import { ParsedQuery } from '../../common/interfaces/interface';
import { DashboardFilterTypes, RegistrationMethod } from '../enums';

const chance = new Chance();
const logger = new Logger('Helper');

export default class Helper {
  static generateStoreLink(
    merchantSubdomain: string,
    storeFrontSubdomain: string,
  ): string {
    const { FRONTEND_BASEURL } = process.env;
    if (!FRONTEND_BASEURL) {
      throw new Error('Missing Environment Credential');
    }
    // to refactor this logic
    merchantSubdomain = 'n/a';
    // const url = new URL(FRONTEND_BASEURL);
    // const baseDomain = url.hostname.replace('api.', '');
    // https://${merchantSubdomain}.${baseDomain}/storefront/${storeFrontSubdomain}`;

    const link = FRONTEND_BASEURL + '/storefront/' + storeFrontSubdomain;

    return link;
  }

  static getSortParams(
    sort: string | undefined,
    defaultParams: [string, SortOrder] = ['createdAt', 'DESC'],
  ): [string, SortOrder] {
    if (!sort) {
      return defaultParams;
    }

    const sortMapping: Record<string, [string, SortOrder]> = {
      desc: ['createdAt', 'DESC'],
      asc: ['createdAt', 'ASC'],
      high_to_low: ['amount', 'DESC'],
      low_to_high: ['amount', 'ASC'],
    };

    return sortMapping[sort.toLowerCase()] || defaultParams;
  }

  static composePagination({
    count,
    page,
    limit,
  }: {
    count: number;
    page: number;
    limit: number | null;
  }) {
    return {
      count,
      totalPages: limit
        ? Math.ceil(count / limit)
        : Math.ceil(count / +DEFAULT_LIMIT),
      currentPage: +page || 1,
      limit: limit ? limit : DEFAULT_LIMIT,
    };
  }

  static generateUniqueCharacters(length: number) {
    return chance.string({ length, alpha: true, numeric: true });
  }

  static generateNumericToken(length: number) {
    return chance.string({ length, numeric: true });
  }

  static formatDate(date: Date) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';

    hours = hours % 12;
    hours = hours ? hours : 12; // Convert 0 to 12

    const formattedDate = `${month} ${day}, ${year}  ${hours}:${minutes
      .toString()
      .padStart(2, '0')}${ampm}`;

    return formattedDate;
  }

  static systemGeneratedTraceId() {
    const generatedNumericId = () => {
      const min = BigInt(10) ** BigInt(19);
      const max = BigInt(10) ** BigInt(20) - BigInt(1);
      return (
        min +
        BigInt(Math.floor(Math.random() * parseFloat((max - min).toString())))
      ).toString();
    };

    const traceId = generatedNumericId();

    return { traceId };
  }

  static generateProductSku(categoryName: string, length: number) {
    const categoryCode = categoryName.split(' ')[0].slice(0, 3).toUpperCase();
    const numericalId =
      Math.floor(Math.random() * (10 ** length - 10 ** (length - 1))) +
      10 ** (length - 1);
    return `${categoryCode}${numericalId}`;
  }

  static checkCartAvailability(cart: any[], stocks: any[]) {
    const stockMap = new Map(stocks.map((item) => [item.id, item]));

    for (const cartItem of cart) {
      if (!stockMap.has(cartItem.id)) {
        throw new BadRequestException(
          `Item with ID '${cartItem.id}' is not available in stock.`,
        );
      }

      const stockItem = stockMap.get(cartItem.id);
      const availableQuantity = stockItem?.quantity || 0;

      cartItem.costPrice = stockItem?.costPrice || 0;

      if (cartItem.quantity > availableQuantity) {
        const itemName = stockItem?.name || `Item with ID '${cartItem.id}'`;

        throw new BadRequestException(
          `Insufficient stock for item '${itemName}'. Only ${availableQuantity} left in stock, but ${cartItem.quantity} requested.`,
        );
      }
    }

    return {
      message: 'All items are available for purchase.',
      cart,
    };
  }

  // Example dictionary of valid terms (can be expanded or fetched from a database)
  static validTerms = [
    'headphones',
    'shoes',
    'running shoes',
    'sneakers',
    'jackets',
    'bags',
    'blue suede shoes',
    'size 12',
    'brand X',
  ];

  /**
   * Suggests spelling corrections for a given input using Levenshtein distance.
   * @param input The user-provided search term.
   * @returns A corrected term or the original input if no suggestions found.
   */
  static suggestSpellingCorrections(input: string): string {
    let closestMatch = input;
    let smallestDistance = Infinity;

    for (const term of this.validTerms) {
      const distance = levenshtein.get(input.toLowerCase(), term.toLowerCase());

      // Check if the current term is closer than the previously found term
      if (distance < smallestDistance) {
        smallestDistance = distance;
        closestMatch = term;
      }
    }

    // Define a threshold to decide when to suggest a correction (e.g., distance <= 3)
    if (smallestDistance <= 3 && closestMatch !== input) {
      return closestMatch;
    }

    return input; // Return original input if no meaningful correction is found
  }

  static getDateRangeThisWeek(
    filterType?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const today = moment().startOf('day');
    let start, end;

    switch (filterType) {
      case 'today':
        start = today;
        end = today.endOf('day');
        break;
      case 'yesterday':
        start = today.subtract(1, 'days').startOf('day');
        end = start.endOf('day');
        break;
        break;
      case 'last_week':
        start = today.subtract(1, 'weeks').startOf('isoWeek');
        end = today.endOf('isoWeek');
        break;
      case 'last_month':
        start = today.subtract(1, 'months').startOf('month');
        end = today.endOf('month');
        break;
      case 'custom':
        start = moment(startDate).startOf('day');
        end = moment(endDate).endOf('day');
        break;
      case 'this_week':
      default:
        start = today.startOf('isoWeek');
        end = today.endOf('isoWeek');
        break;
    }

    return { start: start.toDate(), end: end.toDate() };
  }

  static getDateRange(
    filterType: string = 'today', // Default to 'today'
    startDate?: string,
    endDate?: string,
  ) {
    const today = moment().utc().startOf('day'); // Ensure UTC consistency
    let start, end;

    switch (filterType) {
      case 'yesterday':
        start = today.clone().subtract(1, 'days').startOf('day');
        end = start.clone().endOf('day');
        break;
      case 'last_week':
        start = today.clone().subtract(1, 'weeks').startOf('isoWeek');
        end = start.clone().endOf('isoWeek');
        break;
      case 'this_week':
        start = today.clone().startOf('isoWeek');
        end = today.clone().endOf('isoWeek');
        break;
      case 'this_month':
        start = today.clone().startOf('month');
        end = today.clone().endOf('month');
        break;
      case 'this_year':
        start = today.clone().startOf('year');
        end = today.clone().endOf('year');
        break;

      case 'last_month':
        start = today.clone().subtract(29, 'days').startOf('day'); // 30 total days including today
        end = today.clone().endOf('day'); // includes today's full day
        break;
      case 'custom':
        if (!startDate || !endDate) {
          throw new Error(
            "Custom date range requires both 'startDate' and 'endDate'",
          );
        }
        start = moment.utc(startDate).startOf('day');
        end = moment.utc(endDate).endOf('day');
        break;
      case 'today':
      default:
        start = today.clone().startOf('day');
        end = today.clone().endOf('day');
        break;
    }

    return { start: start.toDate(), end: end.toDate() };
  }

  static getPreviousDayRange() {
    const today = moment().startOf('day');
    const start = today.subtract(1, 'days').startOf('day');
    const end = start.endOf('day');
    return { start: start.toDate(), end: end.toDate() };
  }

  static getPreviousWeekRange() {
    const today = moment().startOf('day');
    const start = today.subtract(1, 'weeks').startOf('isoWeek');
    const end = start.endOf('isoWeek');
    return { start: start.toDate(), end: end.toDate() };
  }

  static getPreviousMonthRange(start: Date, end: Date) {
    const adjustedEnd = end || new Date(); // fallback to now if end not provided
    const adjustedStart = moment(adjustedEnd).subtract(30, 'days').toDate();

    return { start: adjustedStart, end: adjustedEnd };
  }

  static getCustomComparisonRange(start: Date, end: Date) {
    const daysDifference = moment(end).diff(moment(start), 'days');
    const prevStart = moment(start).subtract(daysDifference + 1, 'days');
    const prevEnd = moment(end).subtract(daysDifference + 1, 'days');
    return { start: prevStart.toDate(), end: prevEnd.toDate() };
  }

  static getStartOfDay() {
    return moment().startOf('day').toDate();
  }

  static getEndOfDay() {
    return moment().endOf('day').toDate(); // Returns today at 11:59:59 PM
  }

  static getPreviousEndOfDay() {
    return moment().subtract(1, 'days').endOf('day').toDate();
  }

  static getPreviousStartOfDay() {
    return moment().subtract(1, 'days').startOf('day').toDate();
  }

  static getPreviousPeriodRange(filterType: string, start: Date, end: Date) {
    switch (filterType) {
      case 'today':
        return {
          start: Helper.getPreviousStartOfDay(),
          end: Helper.getPreviousEndOfDay(),
        };
      case 'yesterday':
        return Helper.getPreviousDayRange();
      case 'last_month':
        return Helper.getPreviousMonthRange(start, end);
      case 'custom':
        return Helper.getCustomComparisonRange(start, end);
      case 'this_week':
      default:
        return Helper.getPreviousWeekRange();
    }
  }

  static getPreviousYearRange() {
    const start = moment().subtract(1, 'years').startOf('year');
    const end = moment().subtract(1, 'years').endOf('year');
    return { start: start.toDate(), end: end.toDate() };
  }

  static getPreviousMonthRange2(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    return { start, end };
  }

  static getTaxDateRange(filter: string) {
    const today = moment().endOf('day');
    let startDate, endDate;

    if (filter === 'quarterly') {
      startDate = moment().startOf('quarter');
      endDate = today;
    } else if (filter === 'yearly') {
      startDate = moment().startOf('year');
      endDate = today;
    } else {
      // Default to monthly
      startDate = moment().startOf('month');
      endDate = today;
    }

    return { startDate: startDate.toDate(), endDate: endDate.toDate() };
  }

  static createAxiosInstance = (headers: any | null) => {
    const instance = axios.create({
      headers,
    });

    return instance;
  };

  static shuffleArray = (array: any[]) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  static parseFetchQuery<T>(
    query: T & {
      page?: string;
      limit?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      sort?: string;
    },
    defaultLimit = 20,
  ): ParsedQuery {
    const page = query.page ? Math.max(1, +query.page) : 1;
    const limit = query.limit ? Math.max(0, +query.limit) : defaultLimit;
    const startDate = query.startDate
      ? moment(query.startDate).add(DATE_TIME_OFFSET, 'seconds').toDate()
      : null;
    const endDate = query.endDate
      ? moment(query.endDate).add(DATE_TIME_OFFSET, 'seconds').toDate()
      : null;
    return {
      page,
      limit,
      startDate,
      endDate,
      search: query.search,
      sort: query.sort,
    };
  }

  static formatNumberWithCommas(number: number | string): string {
    if (number) {
      return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } else {
      return '0';
    }
  }

  static async hashText(text: string): Promise<string> {
    const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 10;
    return bcrypt.hash(text, SALT_ROUNDS);
  }

  static async compareHashedText(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  static maskEmail(email: string) {
    return email.replace(/(^.).*(@.*$)/, '$1***$2');
  }

  // static generateAccessToken(user: User, jwt: JwtService, env: string) {
  //   const payload = {
  //     sub: user.id,
  //     email: user.email,
  //     env,
  //     role: user.roles?.[0],
  //   };
  //   return {
  //     accessToken: jwt.sign(payload),
  //     user,
  //   };
  // }

  static getDateRanges(
    startDate?: string,
    endDate?: string,
    filterType: DashboardFilterTypes = DashboardFilterTypes.TODAY,
  ) {
    const todayStart = moment().utc().startOf('day');
    const todayEnd = todayStart.clone().endOf('day');
    const yestEnd = todayStart.clone().subtract(1, 'day').endOf('day');

    const makePrevOfSameLength = (cs: moment.Moment, ce: moment.Moment) => {
      const spanDays =
        ce.clone().endOf('day').diff(cs.clone().startOf('day'), 'days') + 1;
      const prevEnd = cs.clone().subtract(1, 'day').endOf('day');
      const prevStart = prevEnd
        .clone()
        .subtract(spanDays - 1, 'days')
        .startOf('day');
      return { prevStart, prevEnd };
    };

    const useCustom =
      filterType === DashboardFilterTypes.CUSTOM || (startDate && endDate);
    if (useCustom) {
      if (!startDate || !endDate) {
        throw new BadRequestException('Missing start or end date');
      }
      const currentStart = moment.utc(startDate).startOf('day');
      const currentEnd = moment.utc(endDate).endOf('day');
      const { prevStart, prevEnd } = makePrevOfSameLength(
        currentStart,
        currentEnd,
      );
      return {
        currentStart: currentStart.toDate(),
        currentEnd: currentEnd.toDate(),
        previousStart: prevStart.toDate(),
        previousEnd: prevEnd.toDate(),
      };
    }

    let currentStart: moment.Moment;
    let currentEnd: moment.Moment;
    let previousStart: moment.Moment;
    let previousEnd: moment.Moment;

    switch (filterType) {
      case DashboardFilterTypes.TODAY: {
        currentStart = todayStart.clone();
        currentEnd = todayEnd.clone();
        previousStart = todayStart.clone().subtract(1, 'day').startOf('day');
        previousEnd = yestEnd.clone();
        break;
      }

      case DashboardFilterTypes.YESTERDAY: {
        currentStart = todayStart.clone().subtract(1, 'day').startOf('day');
        currentEnd = todayStart.clone().subtract(1, 'day').endOf('day');
        previousStart = currentStart.clone().subtract(1, 'day').startOf('day');
        previousEnd = currentEnd.clone().subtract(1, 'day').endOf('day');
        break;
      }

      case DashboardFilterTypes.THIS_WEEK: {
        currentStart = todayStart.clone().startOf('isoWeek');
        currentEnd = todayEnd.clone();
        if (yestEnd.isBefore(currentStart)) {
          previousStart = currentStart
            .clone()
            .subtract(1, 'week')
            .startOf('isoWeek');
          previousEnd = currentStart
            .clone()
            .subtract(1, 'week')
            .endOf('isoWeek');
        } else {
          previousStart = currentStart.clone();
          previousEnd = yestEnd.clone();
        }
        break;
      }

      case DashboardFilterTypes.LAST_WEEK: {
        currentStart = todayStart
          .clone()
          .subtract(1, 'week')
          .startOf('isoWeek');
        currentEnd = todayStart.clone().subtract(1, 'week').endOf('isoWeek');
        previousStart = currentStart
          .clone()
          .subtract(1, 'week')
          .startOf('isoWeek');
        previousEnd = currentEnd.clone().subtract(1, 'week').endOf('isoWeek');
        break;
      }

      case DashboardFilterTypes.THIS_MONTH: {
        currentStart = todayStart.clone().startOf('month');
        currentEnd = todayEnd.clone();
        if (yestEnd.isBefore(currentStart)) {
          previousStart = currentStart
            .clone()
            .subtract(1, 'month')
            .startOf('month');
          previousEnd = currentStart
            .clone()
            .subtract(1, 'month')
            .endOf('month');
        } else {
          previousStart = currentStart.clone();
          previousEnd = yestEnd.clone();
        }
        break;
      }

      case DashboardFilterTypes.LAST_MONTH: {
        currentStart = todayStart.clone().subtract(1, 'month').startOf('month');
        currentEnd = todayStart.clone().subtract(1, 'month').endOf('month');
        previousStart = currentStart
          .clone()
          .subtract(1, 'month')
          .startOf('month');
        previousEnd = currentStart.clone().subtract(1, 'month').endOf('month');
        break;
      }

      case DashboardFilterTypes.THIS_YEAR:
      default: {
        currentStart = todayStart.clone().startOf('year');
        currentEnd = todayEnd.clone();
        if (yestEnd.isBefore(currentStart)) {
          previousStart = currentStart
            .clone()
            .subtract(1, 'year')
            .startOf('year');
          previousEnd = currentStart.clone().subtract(1, 'year').endOf('year');
        } else {
          previousStart = currentStart.clone();
          previousEnd = yestEnd.clone();
        }
        break;
      }
    }

    return {
      currentStart: currentStart.toDate(),
      currentEnd: currentEnd.toDate(),
      previousStart: previousStart.toDate(),
      previousEnd: previousEnd.toDate(),
    };
  }

  static yearToRange(year?: string | number) {
    let y = Number(year);

    if (!y || isNaN(y)) {
      y = new Date().getUTCFullYear();
    }

    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));
    return { start, end };
  }

  static imageFileFilter(
    req: any,
    file: Express.Multer.File,
    callback: FileFilterCallback,
  ) {
    if (!file.mimetype.match(/^image\/(jpg|jpeg|png)$/)) {
      return callback(
        new BadRequestException(
          'Only JPG, JPEG, and PNG files are allowed!',
        ) as any,
        false,
      );
    }
    callback(null, true);
  }

  static profilePictureUploadOptions = {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: Helper.imageFileFilter,
  };

  static normalize(s?: string): string | undefined {
    return typeof s === 'string' ? s.trim() : s;
  }

  static getEnvironment() {
    const env = process.env.NODE_ENV;
    if (!env || !['development', 'stage', 'production'].includes(env)) {
      logger.error(
        'Invalid environment configuration',
        400,
        'error',
        'Bad Request',
        'getEnvironment',
        env,
      );
      throw new BadRequestException('Invalid environment');
    }
    return env;
  }

  static getRegistrationMethod(input: string): RegistrationMethod {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\+?[0-9]{7,15}$/;

    if (emailRegex.test(input)) return RegistrationMethod.EMAIL;
    if (phoneRegex.test(input)) return RegistrationMethod.PHONE_NUMBER;

    throw new Error('Invalid registration input');
  }
}
