import { z } from "zod";
import { labelConfigSchema, labelObjectBaseSchema, type LabelConfig } from "../types/ObjectType";
import {
  variableSchema,
  csvMappingSchema,
  type Variable,
  type CsvMapping,
} from "../types/Variable";
import type { LabelObject } from "../types/Group";
import { ok, err, type Result } from "./result";

export type DesignFileError = "parse_error" | "invalid_schema";
export interface DesignFilePage { objects: LabelObject[] }
export interface DesignFile {
  label: LabelConfig;
  pages: DesignFilePage[];
  variables: Variable[];
  /** Optional: present only when the user has imported a CSV and set
   *  up a mapping for the current design. Round-trips with the design;
   *  rows themselves are session-only and not part of the save. */
  csvMapping: CsvMapping | null;
}

// Two distinct shapes share the base fields:
//   * leaves carry `props` and have no `children`,
//   * groups carry `children` and have no `props` (their `type` is 'group').
// Split into separate schemas so a leaf missing its `props` or a group
// missing its `children` fails validation. `groupSchema` is wrapped in
// z.lazy so the recursion through `labelObjectSchema` resolves.
const leafSchema = labelObjectBaseSchema.extend({
  type: z.string().refine((t) => t !== 'group', {
    message: "Leaf objects cannot have type 'group'",
  }),
  props: z.record(z.string(), z.unknown()),
});

const groupSchema: z.ZodType<unknown> = z.lazy(() =>
  labelObjectBaseSchema.extend({
    type: z.literal('group'),
    children: z.array(labelObjectSchema),
  }),
);

const labelObjectSchema: z.ZodType<unknown> = z.union([groupSchema, leafSchema]);

const pageSchema = z.object({ objects: z.array(labelObjectSchema) });

const designFileSchema = z.object({
  label: labelConfigSchema,
  pages: z.array(pageSchema),
  // Optional so designs saved before the variables feature still load.
  variables: z.array(variableSchema).optional(),
  // Optional: designs without a CSV import omit the field entirely.
  csvMapping: csvMappingSchema.optional(),
});

const legacyDesignFileSchema = z.object({
  label: labelConfigSchema,
  objects: z.array(labelObjectSchema),
});

export function parseDesignFile(text: string): Result<DesignFile, DesignFileError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("parse_error");
  }

  const current = designFileSchema.safeParse(json);
  if (current.success) {
    // LabelObject[] is a discriminated union with typed props; Zod cannot
    // verify them without per-type schemas, so the cast here is intentional.
    // The registry handles unknown prop shapes gracefully at runtime.
    return ok({
      label: current.data.label,
      pages: current.data.pages as unknown as DesignFilePage[],
      variables: current.data.variables ?? [],
      csvMapping: current.data.csvMapping ?? null,
    });
  }

  // Legacy: { label, objects } from before multi-page support.
  // Wrapped into a single page so older designs keep loading.
  const legacy = legacyDesignFileSchema.safeParse(json);
  if (legacy.success) {
    return ok({
      label: legacy.data.label,
      pages: [{ objects: legacy.data.objects as unknown as LabelObject[] }],
      variables: [],
      csvMapping: null,
    });
  }

  return err("invalid_schema");
}

interface SerializedDesign {
  label: LabelConfig;
  pages: DesignFilePage[];
  variables?: Variable[];
  csvMapping?: CsvMapping;
}

export function serializeDesign(
  label: LabelConfig,
  pages: DesignFilePage[],
  variables: Variable[] = [],
  csvMapping: CsvMapping | null = null,
): string {
  // Omit optional fields when empty so older versions of the app that
  // lack them can keep round-tripping designs untouched.
  const payload: SerializedDesign = { label, pages };
  if (variables.length > 0) payload.variables = variables;
  if (csvMapping) payload.csvMapping = csvMapping;
  return JSON.stringify(payload, null, 2);
}

export const designFileErrors: Record<DesignFileError, string> = {
  parse_error: "Could not read the file. Make sure it is a valid JSON design file.",
  invalid_schema: "The file does not contain a valid label design.",
};
