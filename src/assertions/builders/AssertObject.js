import {
  OPTIMIZED, assertOptimized, assertSizeMax, assertSizeMin,
  isArray, isBoolean, isEnum, isObject, isSchema, isString, isTypedArray, isUndefined
} from '../types'

// private methods
const ASSERT_DEPENDENCIES = Symbol('valiates Object dependencies')
const ASSERT_KEYS = Symbol('validates Object keys')
const ASSERT_PROPERTIES = Symbol('validates Object properties')
const ASSERT_REQUIRED = Symbol('validates Object required')

export default class AssertObject {
  constructor () {
    return AssertObject
  }

  /*
   * object assertions
   */
  static optimize (schema) {
    const { type, dependencies, maxProperties, minProperties, propertyNames, required } = schema
    const innerList = []
    const outerList = []

    // assert and optimize property-processing keywords in schema
    innerList.push(...AssertObject[ASSERT_PROPERTIES](schema))
    if (!isUndefined(dependencies)) innerList.push(AssertObject[ASSERT_DEPENDENCIES](dependencies))
    if (!isUndefined(propertyNames)) {
      innerList.push(AssertObject[ASSERT_KEYS](propertyNames))
    }

    // assert and optimize post-processing keywords in schema
    const { req, assertReq } = AssertObject[ASSERT_REQUIRED](required)
    if (!isUndefined(assertReq)) outerList.push(assertReq)
    if (!isUndefined(maxProperties)) outerList.push(assertSizeMax(maxProperties, 'maxProperties'))
    if (!isUndefined(minProperties)) outerList.push(assertSizeMin(minProperties, 'minProperties'))

    // return validations based on defined keywords
    if (innerList.length || outerList.length) {
      return [async (value, ref) => {
        if (!isObject(value)) {
          if (ref.type === 'object') throw new Error('#type: value is not an object')
          return
        }

        const keys = Object.keys(value)
        const length = keys.length
        let reqCount = 0

        if (innerList.length || Object.keys(req).length) {
          for (let key of keys) {
            const val = value[key]
            // check for required
            if (req[key]) reqCount++
            // asserts [properties, patternProperties, additionalProperties, dependencies, propertyNames]
            if (innerList.length) await assertOptimized([value, key, val], ref, innerList)
          }
        }

        // asserts [required, maxProperties, minProperties]
        if (outerList.length) {
          await assertOptimized({ length, reqCount }, ref, outerList)
        }
      }]
    } else if (type === 'object') {
      return [async (value, ref) => {
        if (!isObject(value)) throw new Error('#type: value is not an object')
      }]
    }
    return []
  }

  static [ASSERT_DEPENDENCIES] (dependencies) {
    // determine if dependencies object contains arrays or schemas
    const keys = Object.keys(dependencies)
    for (let k of keys) {
      const value = dependencies[k]
      if (!((isArray(value) && !value.length) || isEnum(value, isString) || isSchema(value))) {
        throw new TypeError('#dependencies: all dependencies must either be Schemas|enums')
      }
    }

    // return either property dependencies or schema dependencies validations
    return async ([value, key, val], ref) => {
      if (isUndefined(ref.dependencies[key])) return

      if (isArray(ref.dependencies[key])) {
        for (let depKey of ref.dependencies[key]) {
          if (isUndefined(value[depKey])) {
            throw new Error(`#dependencies: value does not have '${key}' dependency`)
          }
        }
      } else return assertOptimized(value, ref.dependencies[key], ref.dependencies[key][OPTIMIZED])
    }
  }

  static [ASSERT_KEYS] (propertyNames) {
    if (!isSchema(propertyNames)) {
      throw new TypeError('#propertyNames: must be a Schema')
    }
    return async ([value, key, val], ref) =>
      assertOptimized(key, ref.propertyNames, ref.propertyNames[OPTIMIZED])
  }

  static [ASSERT_PROPERTIES] (schema) {
    const { properties, patternProperties, additionalProperties } = schema
    const patternProps = {}
    const list = []
    let patternMatch = false

    // attach properties validations if keyword set
    if (isObject(properties)) {
      list.push(async ([value, key, val], ref) => {
        if (isSchema(ref.properties[key])) {
          await assertOptimized(val, ref.properties[key], ref.properties[key][OPTIMIZED])
        }
      })
    } else if (!isUndefined(properties)) throw new TypeError('#properties: must be an Object')

    if (isObject(patternProperties)) {
      const keys = Object.keys(patternProperties)
      for (let k of keys) {
        patternProps[k] = new RegExp(k)
      }
      list.push(async ([value, key, val], ref) => {
        patternMatch = false
        for (let i of keys) {
          if (patternProps[i].test(key)) {
            patternMatch = true
            await assertOptimized(val, ref.patternProperties[i], ref.patternProperties[i][OPTIMIZED])
          }
        }
      })
    } else if (!isUndefined(patternProperties)) throw new TypeError('#patternProperties: must be an Object')

    // attach additionalProperties validations if keyword set
    if (isObject(additionalProperties)) {
      list.push(async ([value, key, val], ref) => {
        if (!(ref.properties && ref.properties[key]) && !patternMatch) {
          await assertOptimized(val, ref.additionalProperties, ref.additionalProperties[OPTIMIZED])
        }
      })
    } else if (isBoolean(additionalProperties) && additionalProperties === false) {
      list.push(async ([value, key, val], ref) => {
        if (!(ref.properties && ref.properties[key]) && !patternMatch) {
          throw new Error('#additionalProperties: additional properties not allowed')
        }
      })
    } else if (!isUndefined(additionalProperties)) throw new TypeError('#additionalProperties: must be either a Schema or Boolean')

    return list
  }

  static [ASSERT_REQUIRED] (list) {
    if (isUndefined(list)) return { req: {} }
    if (!isArray(list) || !isTypedArray(list, isString)) {
      throw new TypeError('#required: required properties must be defined in an array of strings')
    }

    return {
      req: list.reduce((obj, val) => {
        obj[val] = true
        return obj
      }, {}),
      assertReq: async (results, ref) => {
        if (results.reqCount !== ref.required.length) {
          throw new Error('#required: value does not have all required properties')
        }
      }
    }
  }
}
