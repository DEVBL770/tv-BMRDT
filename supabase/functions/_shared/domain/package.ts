import { z } from 'zod';

const InstantSchema = z.iso.datetime({ offset: true });
const DateSchema = z.iso.date();
const TimeSchema = z.iso.time({ precision: -1 });

export const ContentItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'announcement',
      'event',
      'mazal_tov',
      'azkara',
      'dedication',
      'kiddouch',
      'bar_mitsva',
      'photo',
      'pdf',
      'qr',
      'urgent',
      'sponsor',
    ]),
    title: z.string(),
    body: z.string().optional(),
    titleHe: z.string().optional(),
    mediaIds: z.array(z.string()),
    qrUrl: z.url().optional(),
    startsAt: InstantSchema.optional(),
    endsAt: InstantSchema.optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    timeWindows: z.array(z.object({ from: TimeSchema, to: TimeSchema })).optional(),
    shabbatVisibility: z.enum(['show', 'hide']),
    isCommercial: z.boolean(),
    priority: z.number().int(),
    durationSec: z.number().positive(),
  })
  .superRefine((item, context) => {
    if (item.type === 'sponsor' && !item.isCommercial) {
      context.addIssue({
        code: 'custom',
        path: ['isCommercial'],
        message: 'Un contenu sponsor doit être commercial.',
      });
    }
    if (item.startsAt && item.endsAt && Date.parse(item.startsAt) > Date.parse(item.endsAt)) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'La fin doit être postérieure au début.',
      });
    }
  });

const ZmanSchema = z
  .object({
    instant: InstantSchema.optional(),
    sourceId: z.string().optional(),
    overridden: z.boolean().optional(),
  })
  .strict();

const StudyReferenceSchema = z.object({
  reference: z.string(),
  url: z.url().optional(),
});
const StudyTitleSchema = z.object({
  fr: z.string().optional(),
  he: z.string().optional(),
});

export const DaySchema = z.object({
  date: DateSchema,
  weekday: z.number().int().min(0).max(6),
  hebrew: z.object({
    fr: z.string(),
    he: z.string(),
    day: z.number().int().positive(),
    month: z.string(),
    year: z.number().int().positive(),
  }),
  parasha: z.object({ fr: z.string(), he: z.string().optional() }).optional(),
  holidays: z.array(z.string()),
  holidaysHe: z.array(z.string()).optional(),
  holidayKinds: z.array(z.enum(['erev_yomtov', 'yomtov', 'chol_hamoed'])).optional(),
  yomtovLabels: z.array(z.object({ fr: z.string(), he: z.string().optional() })).optional(),
  cholHamoedLabel: z.object({ fr: z.string(), he: z.string().optional() }).optional(),
  specialShabbat: z.object({ fr: z.string(), he: z.string().optional() }).optional(),
  roshHodesh: z.string().optional(),
  omer: z.number().int().positive().optional(),
  study: z.object({
    dafYomi: z.object({ fr: z.string(), he: z.string().optional() }).optional(),
    rambam: StudyTitleSchema.optional(),
    hayomYom: StudyReferenceSchema.optional(),
    tanya: StudyReferenceSchema.optional(),
  }),
  zmanim: z.object({
    alot: ZmanSchema.optional(),
    misheyakir: ZmanSchema.optional(),
    sunrise: ZmanSchema.optional(),
    chatzot: ZmanSchema.optional(),
    sunset: ZmanSchema.optional(),
    tzeit: ZmanSchema.optional(),
    candleLighting: ZmanSchema.optional(),
    havdalah: ZmanSchema.optional(),
  }),
});

export const PublishedPackageSchema = z.object({
  schemaVersion: z.literal(1),
  versionNumber: z.number().int().positive(),
  publishedAt: InstantSchema,
  packageHash: z.string().regex(/^[a-f0-9]{64}$/),
  site: z.object({
    name: z.string(),
    address: z.string(),
    timezone: z.literal('Europe/Paris'),
    attribution: z.array(z.string()),
    logoMediaId: z.string().optional(),
  }),
  methods: z.object({
    status: z.enum(['pending', 'approved']),
    params: z.record(z.string(), z.unknown()),
    approvedBy: z.string().optional(),
    approvedAt: InstantSchema.optional(),
  }),
  horizon: z.object({ firstDate: DateSchema, lastDate: DateSchema }),
  days: z.array(DaySchema),
  religiousPeriods: z.array(
    z.object({
      kind: z.enum(['shabbat', 'yomtov']),
      start: InstantSchema,
      end: InstantSchema,
      label: z.string(),
      labelHe: z.string(),
    }),
  ),
  minyanim: z.array(
    z.object({
      date: DateSchema,
      office: z.string(),
      time: TimeSchema.nullable(),
      cancelled: z.boolean(),
      status: z.enum(['to_confirm', 'confirmed']),
    }),
  ),
  content: z.array(ContentItemSchema),
  layout: z.object({
    mode: z.enum(['fixed', 'playlist']),
    zones: z.record(z.string(), z.unknown()),
    slides: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['schedule', 'shabbat', 'content', 'study', 'media', 'qr']),
        contentIds: z.array(z.string()).optional(),
        durationSec: z.number().positive(),
      }),
    ),
    banner: z.object({ text: z.string(), enabled: z.boolean() }).optional(),
  }),
  media: z.array(
    z.object({
      id: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
      mime: z.string(),
    }),
  ),
  sponsorMargin: z.object({
    beforeMinutes: z.number().nonnegative(),
    afterMinutes: z.number().nonnegative(),
  }),
  hideCommercialOnCholHamoed: z.boolean().default(false),
});

export type PublishedPackage = z.infer<typeof PublishedPackageSchema>;
export type ContentItem = z.infer<typeof ContentItemSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Layout = z.infer<typeof PublishedPackageSchema>['layout'];

export function parsePublishedPackage(value: unknown): PublishedPackage {
  return PublishedPackageSchema.parse(value);
}
