import { type TUnsafe, Type } from "typebox";

/**
 * 创建字符串枚举 schema，兼容不支持 anyOf/const 模式的 provider（如 Google）。
 *
 * TypeBox 标准的 `Type.Union([Type.Literal(...)])` 会生成 `anyOf` + `const` 结构，
 * 部分 provider 不支持；本 helper 用 `Type.Unsafe` 手工构造 JSON Schema 原生的
 * `enum` 数组形式：`{ type: "string", enum: [...] }`。
 *
 * @example
 * const OperationSchema = StringEnum(["add", "subtract", "multiply", "divide"], {
 *   description: "The operation to perform"
 * });
 *
 * type Operation = Static<typeof OperationSchema>; // "add" | "subtract" | "multiply" | "divide"
 */
export function StringEnum<T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: values as any,
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	});
}
