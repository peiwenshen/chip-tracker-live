// src/lib/crud.ts
import supabase from "./supabaseClient";

/**
 * Create a record in the specified table.
 * @param table - The table name.
 * @param record - The record object to insert.
 * @returns The inserted record data.
 */
export const createRecord = async (table: string, record: object) => {
  const { data, error } = await supabase.from(table).insert(record);
  if (error) {
    console.error(`Error creating record in ${table}:`, error);
    throw error;
  }
  return data;
};

/**
 * Read records from the specified table that match the optional query.
 * @param table - The table name.
 * @param query - An optional object containing field match criteria.
 * @returns The retrieved records.
 */
export const readRecords = async (table: string, query: object = {}) => {
  const { data, error } = await supabase.from(table).select("*").match(query);
  if (error) {
    console.error(`Error reading records from ${table}:`, error);
    throw error;
  }
  return data;
};

/**
 * Update a record in the specified table.
 * @param table - The table name.
 * @param idField - The primary key field name.
 * @param idValue - The primary key value of the record to update.
 * @param updates - An object containing the fields to update.
 * @returns The updated record data.
 */
export const updateRecord = async (
  table: string,
  idField: string,
  idValue: any,
  updates: object
) => {
  const { data, error } = await supabase.from(table).update(updates).eq(idField, idValue);
  if (error) {
    console.error(`Error updating record in ${table}:`, error);
    throw error;
  }
  return data;
};

/**
 * Delete a record from the specified table.
 * @param table - The table name.
 * @param idField - The primary key field name.
 * @param idValue - The primary key value of the record to delete.
 * @returns The data returned from the delete operation.
 */
export const deleteRecord = async (table: string, idField: string, idValue: any) => {
  const { data, error } = await supabase.from(table).delete().eq(idField, idValue);
  if (error) {
    console.error(`Error deleting record from ${table}:`, error);
    throw error;
  }
  return data;
};