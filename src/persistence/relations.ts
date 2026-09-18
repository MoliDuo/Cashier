import { relations } from "drizzle-orm";
import { users, loginEmails } from "./schema/auth";
import {
  books,
  ledgers,
  entryCategories,
  ledgerEntries,
  serviceCredentials,
} from "./schema/ledger";
import { sourceDocuments } from "./schema/source-document";

export const usersRelations = relations(users, ({ many }) => ({
  ledgers: many(ledgers),
  loginEmails: many(loginEmails),
}));

export const loginEmailsRelations = relations(loginEmails, ({ one }) => ({
  user: one(users, {
    fields: [loginEmails.userId],
    references: [users.id],
  }),
}));

export const booksRelations = relations(books, ({ one, many }) => ({
  ledger: one(ledgers, {
    fields: [books.ledgerId],
    references: [ledgers.id],
  }),
  sourceDocuments: many(sourceDocuments),
  serviceCredentials: many(serviceCredentials),
}));

export const ledgersRelations = relations(ledgers, ({ one, many }) => ({
  user: one(users, {
    fields: [ledgers.userId],
    references: [users.id],
  }),
  books: many(books),
  ledgerEntries: many(ledgerEntries),
  sourceDocuments: many(sourceDocuments),
  entryCategories: many(entryCategories),
  serviceCredentials: many(serviceCredentials),
}));

export const entryCategoriesRelations = relations(entryCategories, ({ one, many }) => ({
  ledger: one(ledgers, {
    fields: [entryCategories.ledgerId],
    references: [ledgers.id],
  }),
  ledgerEntries: many(ledgerEntries),
}));

export const sourceDocumentsRelations = relations(sourceDocuments, ({ one, many }) => ({
  ledger: one(ledgers, {
    fields: [sourceDocuments.ledgerId],
    references: [ledgers.id],
  }),
  book: one(books, {
    fields: [sourceDocuments.bookId],
    references: [books.id],
  }),
  ledgerEntries: many(ledgerEntries),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  ledger: one(ledgers, {
    fields: [ledgerEntries.ledgerId],
    references: [ledgers.id],
  }),
  category: one(entryCategories, {
    fields: [ledgerEntries.categoryId],
    references: [entryCategories.id],
  }),
  sourceDocument: one(sourceDocuments, {
    fields: [ledgerEntries.sourceDocumentId],
    references: [sourceDocuments.id],
  }),
}));

export const serviceCredentialsRelations = relations(serviceCredentials, ({ one }) => ({
  ledger: one(ledgers, {
    fields: [serviceCredentials.ledgerId],
    references: [ledgers.id],
  }),
  book: one(books, {
    fields: [serviceCredentials.bookId],
    references: [books.id],
  }),
}));
