import type { FromSchema } from "json-schema-to-ts";
import type { fragmentV1Schema } from "./fragment-schema.js";
import type { projectV1Schema } from "./project-schema.js";

/** 类型与 standalone validator 均由同一份 JSON Schema 推导。 */
export type ProjectV1Document = FromSchema<typeof projectV1Schema>;
export type FragmentV1Document = FromSchema<typeof fragmentV1Schema>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export type ProjectLineage = Exclude<ProjectV1Document["lineage"], null>;
