import { z } from "zod";

const xHandlePattern = /^[A-Za-z0-9_]{1,15}$/;
const statusUrlPattern = /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)\/?$/;

export const xHandleSchema = z
  .string()
  .regex(xHandlePattern, "X handle must be 1-15 letters, numbers, or underscores.");

export const xStatusIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[0-9]+$/, "X status id must be numeric.");

export const xStatusUrlSchema = z
  .string()
  .max(4_096)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        (host === "x.com" ||
          host === "www.x.com" ||
          host === "mobile.x.com" ||
          host === "twitter.com" ||
          host === "www.twitter.com" ||
          host === "mobile.twitter.com") &&
        statusUrlPattern.test(url.pathname)
      );
    } catch {
      return false;
    }
  }, "Status URL must be an X/Twitter status URL.");

export const statusIdFromStatusUrl = (value: string): string | undefined => {
  try {
    const pathname = new URL(value).pathname;
    return statusUrlPattern.exec(pathname)?.[2];
  } catch {
    return undefined;
  }
};

export const statusUrlMatchesStatusId = (url: string, statusId: string): boolean =>
  statusIdFromStatusUrl(url) === statusId;
