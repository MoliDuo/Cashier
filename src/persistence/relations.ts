import { relations } from "drizzle-orm";
import { users, loginEmails } from "./schema/auth";
import { books, entryCategories, ledgerEntries, serviceCredentials } from "./schema/ledger";
import { sourceDocuments } from "./schema/source-document";

export const usersRelations = relations(users, ({ many }) => ({
  loginEmails: many(loginEmails),
}));

export const loginEmailsRelations = relations(loginEmails, ({ one }) => ({
  user: one(users, {
    fields: [loginEmails.userId],
    references: [users.id],
  }),
}));

export const booksRelations = relations(books, ({ many }) => ({
  sourceDocuments: many(sourceDocuments),
  serviceCredentials: many(serviceCredentials),
}));

export const entryCategoriesRelations = relations(entryCategories, ({ many }) => ({
  ledgerEntries: many(ledgerEntries),
}));

export const sourceDocumentsRelations = relations(sourceDocuments, ({ one, many }) => ({
  book: one(books, {
    fields: [sourceDocuments.bookId],
    references: [books.id],
  }),
  ledgerEntries: many(ledgerEntries),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
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
  book: one(books, {
    fields: [serviceCredentials.bookId],
    references: [books.id],
  }),
}));
