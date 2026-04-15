#!/usr/bin/env node
/**
 * Test corpus generator for sql-validate.
 *
 * Generates ~200 source files (.cs, .ts, .sql, .py) with embedded SQL queries,
 * mixing valid references with intentional errors. Outputs a manifest JSON
 * documenting every expected error for verification.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const MANIFEST_PATH = path.join(__dirname, "expected-errors.json");

// ── Schema knowledge (mirrors the 5 schema files) ──

const TABLES = {
  "auth.Users": ["UserId","Email","UserName","PasswordHash","FirstName","LastName","PhoneNumber","AvatarUrl","IsActive","IsLocked","FailedLoginAttempts","LastLoginDate","CreatedDate","ModifiedDate","CreatedBy"],
  "auth.Roles": ["RoleId","RoleName","Description","IsSystem","CreatedDate"],
  "auth.UserRoles": ["UserRoleId","UserId","RoleId","AssignedDate","AssignedBy"],
  "auth.Permissions": ["PermissionId","PermissionName","Resource","Action","Description"],
  "auth.RolePermissions": ["RolePermissionId","RoleId","PermissionId"],
  "auth.AuditLog": ["AuditId","UserId","Action","EntityType","EntityId","OldValues","NewValues","IpAddress","UserAgent","Timestamp"],
  "auth.Sessions": ["SessionId","UserId","Token","IpAddress","UserAgent","ExpiresAt","CreatedAt","IsRevoked"],
  "catalog.Categories": ["CategoryId","CategoryName","ParentCategoryId","Slug","Description","ImageUrl","SortOrder","IsActive","CreatedDate"],
  "catalog.Products": ["ProductId","SKU","ProductName","Description","ShortDescription","CategoryId","BrandId","BasePrice","SalePrice","CostPrice","Weight","Length","Width","Height","ImageUrl","IsActive","IsFeatured","TaxCategoryId","CreatedDate","ModifiedDate"],
  "catalog.Brands": ["BrandId","BrandName","LogoUrl","WebsiteUrl","IsActive"],
  "catalog.ProductVariants": ["VariantId","ProductId","VariantName","SKU","PriceAdjustment","StockQuantity","IsActive"],
  "catalog.ProductImages": ["ImageId","ProductId","ImageUrl","AltText","SortOrder","IsPrimary"],
  "catalog.ProductTags": ["TagId","ProductId","TagName"],
  "catalog.ProductReviews": ["ReviewId","ProductId","UserId","Rating","Title","ReviewText","IsVerified","IsApproved","CreatedDate"],
  "catalog.Inventory": ["InventoryId","ProductId","VariantId","WarehouseId","QuantityOnHand","QuantityReserved","ReorderLevel","ReorderQuantity","LastRestockedDate"],
  "catalog.Warehouses": ["WarehouseId","WarehouseName","Address","City","State","ZipCode","IsActive"],
  "sales.Orders": ["OrderId","OrderNumber","UserId","OrderDate","Status","SubTotal","TaxAmount","ShippingAmount","DiscountAmount","GrandTotal","CurrencyCode","PaymentMethod","PaymentStatus","ShippingMethod","TrackingNumber","Notes","CancelledDate","CompletedDate","CreatedDate","ModifiedDate"],
  "sales.OrderItems": ["OrderItemId","OrderId","ProductId","VariantId","ProductName","SKU","Quantity","UnitPrice","DiscountAmount","TaxAmount","LineTotal"],
  "sales.ShippingAddresses": ["AddressId","OrderId","RecipientName","Street1","Street2","City","State","ZipCode","Country","PhoneNumber"],
  "sales.Payments": ["PaymentId","OrderId","Amount","PaymentMethod","TransactionId","Status","ProcessedDate","CreatedDate"],
  "sales.Coupons": ["CouponId","CouponCode","Description","DiscountType","DiscountValue","MinimumOrderAmount","MaxUsageCount","CurrentUsageCount","StartDate","EndDate","IsActive"],
  "sales.OrderCoupons": ["OrderCouponId","OrderId","CouponId","DiscountApplied"],
  "sales.Returns": ["ReturnId","OrderId","OrderItemId","Reason","Status","RefundAmount","RequestedDate","ProcessedDate"],
  "hr.Departments": ["DepartmentId","DepartmentName","DepartmentCode","ManagerId","ParentDepartmentId","Budget","IsActive","CreatedDate"],
  "hr.Employees": ["EmployeeId","UserId","EmployeeNumber","FirstName","LastName","Email","PhoneNumber","DepartmentId","ManagerId","JobTitle","HireDate","TerminationDate","Salary","EmploymentType","IsActive","CreatedDate","ModifiedDate"],
  "hr.TimeEntries": ["TimeEntryId","EmployeeId","EntryDate","HoursWorked","ProjectCode","Description","IsApproved","ApprovedBy","CreatedDate"],
  "hr.LeaveRequests": ["LeaveRequestId","EmployeeId","LeaveType","StartDate","EndDate","TotalDays","Reason","Status","ApprovedBy","CreatedDate"],
  "hr.PerformanceReviews": ["ReviewId","EmployeeId","ReviewerId","ReviewPeriod","OverallRating","Strengths","AreasForImprovement","Goals","ReviewDate","Status"],
  "msg.Conversations": ["ConversationId","Subject","ConversationType","CreatedBy","CreatedDate","LastMessageDate","IsArchived"],
  "msg.ConversationParticipants": ["ParticipantId","ConversationId","UserId","JoinedDate","LeftDate","IsAdmin","IsMuted","LastReadMessageId"],
  "msg.Messages": ["MessageId","ConversationId","SenderId","MessageText","MessageType","IsEdited","IsDeleted","ParentMessageId","SentDate","EditedDate"],
  "msg.Attachments": ["AttachmentId","MessageId","FileName","FileSize","ContentType","StoragePath","UploadedDate"],
  "msg.Notifications": ["NotificationId","UserId","Title","Body","NotificationType","ReferenceType","ReferenceId","IsRead","CreatedDate","ReadDate"],
};

const FUNCTIONS = [
  "auth.fn_GetUserFullName", "auth.fn_HasPermission",
  "catalog.fn_GetProductPrice", "catalog.fn_GetAvailableStock",
  "sales.fn_CalculateOrderTotal", "sales.fn_GetOrderStatus",
  "hr.fn_GetEmployeeTenure", "msg.fn_GetUnreadCount",
];

const PROCEDURES = [
  "auth.sp_AuthenticateUser", "auth.sp_CreateSession", "auth.sp_RevokeSession",
  "catalog.sp_SearchProducts", "catalog.sp_UpdateInventory",
  "sales.sp_PlaceOrder", "sales.sp_CancelOrder", "sales.sp_ProcessRefund",
  "hr.sp_GetDepartmentHeadcount", "hr.sp_ApproveLeaveRequest",
  "msg.sp_SendMessage", "msg.sp_MarkAsRead",
];

const INDEXES = {
  "auth.Users": ["IX_Users_Email","IX_Users_UserName"],
  "auth.UserRoles": ["IX_UserRoles_UserId"],
  "auth.AuditLog": ["IX_AuditLog_UserId_Timestamp"],
  "auth.Sessions": ["IX_Sessions_UserId"],
  "catalog.Products": ["IX_Products_SKU","IX_Products_CategoryId","IX_Products_BrandId"],
  "catalog.ProductVariants": ["IX_ProductVariants_ProductId"],
  "catalog.Inventory": ["IX_Inventory_ProductId_WarehouseId"],
  "catalog.ProductReviews": ["IX_ProductReviews_ProductId"],
  "sales.Orders": ["IX_Orders_UserId","IX_Orders_OrderNumber","IX_Orders_Status"],
  "sales.OrderItems": ["IX_OrderItems_OrderId"],
  "sales.Payments": ["IX_Payments_OrderId"],
  "sales.Coupons": ["IX_Coupons_CouponCode"],
  "msg.Messages": ["IX_Messages_ConversationId"],
  "msg.Notifications": ["IX_Notifications_UserId"],
  "msg.ConversationParticipants": ["IX_ConversationParticipants_UserId"],
};

// ── Invalid references for injection ──

const FAKE_TABLES = [
  "auth.UserProfiles", "auth.LoginHistory", "auth.ApiKeys", "auth.TwoFactorTokens",
  "catalog.ProductPriceHistory", "catalog.Wishlists", "catalog.CompareList",
  "sales.Invoices", "sales.ShipmentTracking", "sales.Cart", "sales.CartItems",
  "hr.Payroll", "hr.Benefits", "hr.Certifications", "hr.TrainingRecords",
  "msg.MessageReactions", "msg.Channels", "msg.UserPresence",
  "dbo.Customers", "dbo.Settings", "dbo.Config", "dbo.EmailQueue",
];

const FAKE_COLUMNS = {
  "auth.Users": ["FullName","DisplayName","DateOfBirth","Address","ZipCode","Gender","Timezone","Language","Status","ProfileImage"],
  "catalog.Products": ["Price","Name","Title","Quantity","StockLevel","Rating","ReviewCount","Color","Size","Material"],
  "sales.Orders": ["Total","Amount","CustomerName","Email","Address","Phone","OrderTotal","ItemCount","Weight","DeliveryDate"],
  "sales.OrderItems": ["TotalPrice","SubTotal","Name","ItemName","Cost","Price","Weight","Tax"],
  "hr.Employees": ["FullName","Age","Address","City","State","ZipCode","BenefitPlan","VacationDays"],
  "hr.Departments": ["Name","Code","Location","Floor","HeadCount"],
  "msg.Messages": ["Content","Body","Text","Subject","Priority","ReadDate"],
  "msg.Notifications": ["Message","Priority","Severity","Category","Channel"],
};

const FAKE_FUNCTIONS = [
  "auth.fn_GetUserEmail", "auth.fn_IsAdmin", "auth.fn_ValidateToken",
  "catalog.fn_GetProductRating", "catalog.fn_CalculateDiscount", "catalog.fn_IsInStock",
  "sales.fn_GetOrderTotal", "sales.fn_GetShippingCost", "sales.fn_ApplyDiscount",
  "hr.fn_GetEmployeeAge", "hr.fn_CalculateVacation", "hr.fn_GetAnnualSalary",
  "msg.fn_GetMessageCount", "msg.fn_IsOnline", "msg.fn_GetLastActive",
];

const FAKE_INDEXES = [
  "IX_Users_EmailAddress", "IX_Users_FullName", "IX_Users_Status",
  "IX_Products_Name", "IX_Products_Price", "IX_Products_Category",
  "IX_Orders_Date", "IX_Orders_Customer", "IX_Orders_Total",
  "IX_Employees_Name", "IX_Employees_HireDate",
  "IX_Messages_Date", "IX_Messages_Sender",
];

// ── Generation state ──
const expectedErrors = [];
let fileCount = 0;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) {
  const copy = [...arr];
  const result = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

const tableNames = Object.keys(TABLES);
function getAlias(table) {
  const parts = table.split(".");
  return parts[1].charAt(0).toLowerCase();
}
function getSchema(table) { return table.split(".")[0]; }
function getTableName(table) { return table.split(".")[1]; }

// ── File generators ──

function genCsRepo(domain, table, queries) {
  const className = getTableName(table) + "Repository";
  const ns = `MyApp.Repositories.${capitalize(domain)}`;
  let lines = [
    `using System;`,
    `using System.Data;`,
    `using System.Data.SqlClient;`,
    `using System.Threading.Tasks;`,
    ``,
    `namespace ${ns}`,
    `{`,
    `    public class ${className}`,
    `    {`,
    `        private readonly string _connectionString;`,
    ``,
    `        public ${className}(string connectionString)`,
    `        {`,
    `            _connectionString = connectionString;`,
    `        }`,
  ];

  for (const q of queries) {
    lines.push(``);
    lines.push(`        public async Task<DataTable> ${q.method}(${q.params})`);
    lines.push(`        {`);
    lines.push(`            using var conn = new SqlConnection(_connectionString);`);
    lines.push(`            await conn.OpenAsync();`);
    // SQL starts on the next line
    const sqlStartLine = lines.length + 1; // 1-indexed
    lines.push(`            var query = @"${q.sql.split("\n")[0]}`);
    const sqlLines = q.sql.split("\n");
    for (let i = 1; i < sqlLines.length; i++) {
      lines.push(`                          ${sqlLines[i]}`);
    }
    lines[lines.length - 1] += `";`;
    const sqlEndLine = lines.length;
    // Record errors with adjusted line numbers
    for (const err of q.errors) {
      expectedErrors.push({
        ...err,
        file: null, // will be set when we know the filename
        line: sqlStartLine + (err.lineOffset || 0),
        _fileKey: `${domain}/${className}.cs`,
      });
    }
    lines.push(`            // execute query...`);
    lines.push(`            return new DataTable();`);
    lines.push(`        }`);
  }

  lines.push(`    }`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

function genTsService(domain, table, queries) {
  const className = getTableName(table) + "Service";
  let lines = [
    `import { Database } from '../database';`,
    `import { ${getTableName(table)} } from '../models/${getTableName(table)}';`,
    ``,
    `export class ${className} {`,
    `  private db: Database;`,
    ``,
    `  constructor(db: Database) {`,
    `    this.db = db;`,
    `  }`,
  ];

  for (const q of queries) {
    lines.push(``);
    lines.push(`  async ${q.method}(${q.params}): Promise<${getTableName(table)}[]> {`);
    const sqlStartLine = lines.length + 1;
    lines.push(`    return this.db.query(\``);
    const sqlLines = q.sql.split("\n");
    for (const sl of sqlLines) {
      lines.push(`      ${sl}`);
    }
    lines.push(`    \`);`);
    for (const err of q.errors) {
      expectedErrors.push({
        ...err,
        file: null,
        line: sqlStartLine + 1 + (err.lineOffset || 0),
        _fileKey: `${domain}/${className}.ts`,
      });
    }
    lines.push(`  }`);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

function genSqlScript(domain, queries) {
  let lines = [
    `-- ${capitalize(domain)} domain queries`,
    `-- Generated test script`,
    ``,
  ];

  for (const q of queries) {
    lines.push(`-- ${q.comment || q.method}`);
    const sqlStartLine = lines.length + 1;
    const sqlLines = q.sql.split("\n");
    for (const sl of sqlLines) {
      lines.push(sl);
    }
    lines.push(`GO`);
    lines.push(``);
    for (const err of q.errors) {
      expectedErrors.push({
        ...err,
        file: null,
        line: sqlStartLine + (err.lineOffset || 0),
        _fileKey: `${domain}/${domain}_queries.sql`,
      });
    }
  }

  return lines.join("\n");
}

function genPyDao(domain, table, queries) {
  const className = getTableName(table) + "Dao";
  let lines = [
    `import pyodbc`,
    `from typing import List, Optional, Dict, Any`,
    ``,
    ``,
    `class ${className}:`,
    `    def __init__(self, connection_string: str):`,
    `        self.conn_str = connection_string`,
    ``,
  ];

  for (const q of queries) {
    lines.push(`    def ${q.method}(self, ${q.params || ""}):`);
    lines.push(`        conn = pyodbc.connect(self.conn_str)`);
    lines.push(`        cursor = conn.cursor()`);
    const sqlStartLine = lines.length + 1;
    lines.push(`        query = """`);
    const sqlLines = q.sql.split("\n");
    for (const sl of sqlLines) {
      lines.push(`            ${sl}`);
    }
    lines.push(`        """`);
    for (const err of q.errors) {
      expectedErrors.push({
        ...err,
        file: null,
        line: sqlStartLine + 1 + (err.lineOffset || 0),
        _fileKey: `${domain}/${className}.py`,
      });
    }
    lines.push(`        cursor.execute(query)`);
    lines.push(`        return cursor.fetchall()`);
    lines.push(``);
  }

  return lines.join("\n");
}

// ── Query builders (valid + invalid) ──

function validSelect(table, numCols) {
  const cols = TABLES[table];
  const selected = pickN(cols, Math.min(numCols || 4, cols.length));
  const alias = getAlias(table);
  const colList = selected.map(c => `${alias}.${c}`).join(", ");
  return {
    sql: `SELECT ${colList}\nFROM ${table} ${alias}`,
    errors: [],
  };
}

function validSelectWhere(table, numCols) {
  const cols = TABLES[table];
  const selected = pickN(cols, Math.min(numCols || 3, cols.length));
  const whereCol = pick(cols);
  const alias = getAlias(table);
  const colList = selected.map(c => `${alias}.${c}`).join(", ");
  return {
    sql: `SELECT ${colList}\nFROM ${table} ${alias}\nWHERE ${alias}.${whereCol} = @Param1`,
    errors: [],
  };
}

function validJoin(table1, table2, joinCol) {
  const a1 = "a";
  const a2 = "b";
  const cols1 = pickN(TABLES[table1], 2).map(c => `${a1}.${c}`);
  const cols2 = pickN(TABLES[table2], 2).map(c => `${a2}.${c}`);
  return {
    sql: `SELECT ${[...cols1, ...cols2].join(", ")}\nFROM ${table1} ${a1}\nINNER JOIN ${table2} ${a2} ON ${a1}.${joinCol} = ${a2}.${joinCol}`,
    errors: [],
  };
}

function validInsert(table) {
  const cols = TABLES[table].filter(c => c !== TABLES[table][0]); // skip identity col
  const selected = pickN(cols, Math.min(4, cols.length));
  const colList = selected.join(", ");
  const vals = selected.map((_, i) => `@P${i + 1}`).join(", ");
  return {
    sql: `INSERT INTO ${table} (${colList})\nVALUES (${vals})`,
    errors: [],
  };
}

function validUpdate(table) {
  const cols = TABLES[table].filter(c => c !== TABLES[table][0]);
  const setCols = pickN(cols, 2);
  const whereCol = TABLES[table][0];
  const alias = getAlias(table);
  const sets = setCols.map((c, i) => `${c} = @P${i + 1}`).join(", ");
  return {
    sql: `UPDATE ${table}\nSET ${sets}\nWHERE ${whereCol} = @Id`,
    errors: [],
  };
}

function validDelete(table) {
  const whereCol = TABLES[table][0];
  return {
    sql: `DELETE FROM ${table}\nWHERE ${whereCol} = @Id`,
    errors: [],
  };
}

function validExec(proc) {
  return {
    sql: `EXEC ${proc} @Param1 = 1`,
    errors: [],
  };
}

function validFuncCall(func) {
  return {
    sql: `SELECT ${func}(@Param1) AS Result`,
    errors: [],
  };
}

// ── Error injectors ──

function invalidColumn(table) {
  const alias = getAlias(table);
  const fakeCol = pick(FAKE_COLUMNS[table] || ["FakeColumn", "BadName", "Nonexistent"]);
  const validCols = pickN(TABLES[table], 2).map(c => `${alias}.${c}`);
  return {
    sql: `SELECT ${validCols.join(", ")}, ${alias}.${fakeCol}\nFROM ${table} ${alias}`,
    errors: [{ type: "INVALID_COLUMN", errorDetail: `${fakeCol} on ${table}`, lineOffset: 0 }],
  };
}

function invalidTable() {
  const fakeTable = pick(FAKE_TABLES);
  const alias = fakeTable.split(".")[1].charAt(0).toLowerCase();
  return {
    sql: `SELECT ${alias}.Id, ${alias}.Name\nFROM ${fakeTable} ${alias}`,
    errors: [{ type: "INVALID_TABLE", errorDetail: fakeTable, lineOffset: 1 }],
  };
}

function invalidFunction() {
  const fakeFunc = pick(FAKE_FUNCTIONS);
  return {
    sql: `SELECT ${fakeFunc}(@Param1) AS Result`,
    errors: [{ type: "INVALID_FUNCTION", errorDetail: fakeFunc, lineOffset: 0 }],
  };
}

function invalidIndex(table) {
  const alias = getAlias(table);
  const fakeIdx = pick(FAKE_INDEXES);
  const cols = pickN(TABLES[table], 2).map(c => `${alias}.${c}`);
  return {
    sql: `SELECT ${cols.join(", ")}\nFROM ${table} ${alias} WITH (INDEX(${fakeIdx}))\nWHERE ${alias}.${TABLES[table][0]} = @Id`,
    errors: [{ type: "INVALID_INDEX", errorDetail: `${fakeIdx} on ${table}`, lineOffset: 1 }],
  };
}

function invalidColumnInJoin(table1, table2, joinCol) {
  const a1 = "a", a2 = "b";
  const fakeCol = pick(FAKE_COLUMNS[table1] || ["BadCol"]);
  const validCol2 = pick(TABLES[table2]);
  return {
    sql: `SELECT ${a1}.${fakeCol}, ${a2}.${validCol2}\nFROM ${table1} ${a1}\nINNER JOIN ${table2} ${a2} ON ${a1}.${joinCol} = ${a2}.${joinCol}`,
    errors: [{ type: "INVALID_COLUMN", errorDetail: `${fakeCol} on ${table1}`, lineOffset: 0 }],
  };
}

function multipleErrors(table) {
  const alias = getAlias(table);
  const fakeCol1 = pick(FAKE_COLUMNS[table] || ["BadCol1"]);
  const fakeCol2 = pick(FAKE_COLUMNS[table] || ["BadCol2"]);
  const validCol = pick(TABLES[table]);
  const errors = [];
  errors.push({ type: "INVALID_COLUMN", errorDetail: `${fakeCol1} on ${table}`, lineOffset: 0 });
  if (fakeCol1 !== fakeCol2) {
    errors.push({ type: "INVALID_COLUMN", errorDetail: `${fakeCol2} on ${table}`, lineOffset: 0 });
  }
  return {
    sql: `SELECT ${alias}.${validCol}, ${alias}.${fakeCol1}, ${alias}.${fakeCol2}\nFROM ${table} ${alias}`,
    errors,
  };
}

function invalidTableAndColumn() {
  const fakeTable = pick(FAKE_TABLES);
  const alias = fakeTable.split(".")[1].charAt(0).toLowerCase();
  return {
    sql: `SELECT ${alias}.Id, ${alias}.FakeColumn\nFROM ${fakeTable} ${alias}\nWHERE ${alias}.Id = @Id`,
    errors: [
      { type: "INVALID_TABLE", errorDetail: fakeTable, lineOffset: 1 },
      // columns on a fake table won't be validated (table is unknown)
    ],
  };
}

function invalidExec() {
  const schema = pick(["auth", "catalog", "sales", "hr", "msg"]);
  const fakeName = "sp_" + pick(["RunReport", "ExportData", "SyncRecords", "CleanupOld", "GenerateInvoice", "RecalculateTotals", "MigrateData", "ArchiveOld"]);
  return {
    sql: `EXEC ${schema}.${fakeName} @Param1 = 1`,
    // Note: our tool skips sp_ prefixed procedures in EXEC checks, so these won't be caught
    errors: [],
  };
}

// ── Domain-specific query templates ──

const DOMAIN_QUERIES = {
  auth: [
    () => ({ method: "GetById", params: "int userId", ...validSelectWhere("auth.Users", 5), comment: "Get user by ID" }),
    () => ({ method: "GetAll", params: "", ...validSelect("auth.Users", 6), comment: "Get all users" }),
    () => ({ method: "GetUserRoles", params: "int userId", ...validJoin("auth.Users", "auth.UserRoles", "UserId"), comment: "Get user roles" }),
    () => ({ method: "GetActiveUsers", params: "", ...validSelectWhere("auth.Users", 4), comment: "Active users" }),
    () => ({ method: "CreateUser", params: "User user", ...validInsert("auth.Users"), comment: "Create user" }),
    () => ({ method: "UpdateUser", params: "int id, User user", ...validUpdate("auth.Users"), comment: "Update user" }),
    () => ({ method: "DeleteUser", params: "int id", ...validDelete("auth.Users"), comment: "Delete user" }),
    () => ({ method: "GetRoles", params: "", ...validSelect("auth.Roles", 3), comment: "Get roles" }),
    () => ({ method: "GetAuditLog", params: "int userId", ...validSelectWhere("auth.AuditLog", 4), comment: "Audit log" }),
    () => ({ method: "GetSessions", params: "int userId", ...validSelectWhere("auth.Sessions", 5), comment: "User sessions" }),
    () => ({ method: "AuthenticateUser", params: "string email", ...validExec("auth.sp_AuthenticateUser"), comment: "Authenticate" }),
    () => ({ method: "GetUserFullName", params: "int id", ...validFuncCall("auth.fn_GetUserFullName"), comment: "Full name" }),
    // ERRORS:
    () => ({ method: "GetUserProfile_BAD", params: "int id", ...invalidTable(), comment: "BAD: fake table" }),
    () => ({ method: "GetUserDisplayName_BAD", params: "int id", ...invalidColumn("auth.Users"), comment: "BAD: fake column on Users" }),
    () => ({ method: "ValidateToken_BAD", params: "string token", ...invalidFunction(), comment: "BAD: fake function" }),
    () => ({ method: "SearchByEmail_BAD", params: "string email", ...invalidIndex("auth.Users"), comment: "BAD: fake index" }),
    () => ({ method: "GetUserDetails_BAD", params: "int id", ...multipleErrors("auth.Users"), comment: "BAD: multiple fake columns" }),
  ],
  catalog: [
    () => ({ method: "GetProduct", params: "int id", ...validSelectWhere("catalog.Products", 6), comment: "Get product" }),
    () => ({ method: "GetCategories", params: "", ...validSelect("catalog.Categories", 4), comment: "Get categories" }),
    () => ({ method: "GetBrands", params: "", ...validSelect("catalog.Brands", 3), comment: "Get brands" }),
    () => ({ method: "GetVariants", params: "int productId", ...validSelectWhere("catalog.ProductVariants", 4), comment: "Variants" }),
    () => ({ method: "GetImages", params: "int productId", ...validSelectWhere("catalog.ProductImages", 4), comment: "Images" }),
    () => ({ method: "GetReviews", params: "int productId", ...validSelectWhere("catalog.ProductReviews", 5), comment: "Reviews" }),
    () => ({ method: "GetInventory", params: "int productId", ...validSelectWhere("catalog.Inventory", 4), comment: "Inventory" }),
    () => ({ method: "GetWarehouses", params: "", ...validSelect("catalog.Warehouses", 4), comment: "Warehouses" }),
    () => ({ method: "CreateProduct", params: "Product p", ...validInsert("catalog.Products"), comment: "Create product" }),
    () => ({ method: "UpdateProduct", params: "int id", ...validUpdate("catalog.Products"), comment: "Update product" }),
    () => ({ method: "SearchProducts", params: "string term", ...validExec("catalog.sp_SearchProducts"), comment: "Search" }),
    () => ({ method: "GetPrice", params: "int id", ...validFuncCall("catalog.fn_GetProductPrice"), comment: "Get price" }),
    () => ({ method: "GetStock", params: "int id", ...validFuncCall("catalog.fn_GetAvailableStock"), comment: "Get stock" }),
    // ERRORS:
    () => ({ method: "GetWishlist_BAD", params: "int userId", ...invalidTable(), comment: "BAD: fake table" }),
    () => ({ method: "GetProductPrice_BAD", params: "int id", ...invalidColumn("catalog.Products"), comment: "BAD: fake column" }),
    () => ({ method: "GetDiscount_BAD", params: "int id", ...invalidFunction(), comment: "BAD: fake function" }),
    () => ({ method: "SearchBySKU_BAD", params: "string sku", ...invalidIndex("catalog.Products"), comment: "BAD: fake index" }),
    () => ({ method: "GetProductDetails_BAD", params: "int id", ...multipleErrors("catalog.Products"), comment: "BAD: multi errors" }),
    () => ({ method: "GetMissingJoin_BAD", params: "int id", ...invalidColumnInJoin("catalog.Products", "catalog.Categories", "CategoryId"), comment: "BAD: fake column in join" }),
  ],
  sales: [
    () => ({ method: "GetOrder", params: "int id", ...validSelectWhere("sales.Orders", 6), comment: "Get order" }),
    () => ({ method: "GetOrderItems", params: "int orderId", ...validSelectWhere("sales.OrderItems", 5), comment: "Order items" }),
    () => ({ method: "GetPayments", params: "int orderId", ...validSelectWhere("sales.Payments", 4), comment: "Payments" }),
    () => ({ method: "GetCoupons", params: "", ...validSelect("sales.Coupons", 5), comment: "Coupons" }),
    () => ({ method: "GetReturns", params: "int orderId", ...validSelectWhere("sales.Returns", 4), comment: "Returns" }),
    () => ({ method: "GetShippingAddress", params: "int orderId", ...validSelectWhere("sales.ShippingAddresses", 5), comment: "Shipping" }),
    () => ({ method: "CreateOrder", params: "Order o", ...validInsert("sales.Orders"), comment: "Create order" }),
    () => ({ method: "UpdateOrderStatus", params: "int id", ...validUpdate("sales.Orders"), comment: "Update status" }),
    () => ({ method: "PlaceOrder", params: "int userId", ...validExec("sales.sp_PlaceOrder"), comment: "Place order" }),
    () => ({ method: "CancelOrder", params: "int id", ...validExec("sales.sp_CancelOrder"), comment: "Cancel" }),
    () => ({ method: "GetOrderTotal", params: "int id", ...validFuncCall("sales.fn_CalculateOrderTotal"), comment: "Order total" }),
    () => ({ method: "GetOrderJoin", params: "int userId", ...validJoin("sales.Orders", "sales.OrderItems", "OrderId"), comment: "Order with items" }),
    // ERRORS:
    () => ({ method: "GetInvoice_BAD", params: "int id", ...invalidTable(), comment: "BAD: fake table" }),
    () => ({ method: "GetOrderAmount_BAD", params: "int id", ...invalidColumn("sales.Orders"), comment: "BAD: fake column" }),
    () => ({ method: "GetItemPrice_BAD", params: "int id", ...invalidColumn("sales.OrderItems"), comment: "BAD: fake column on items" }),
    () => ({ method: "CalcShipping_BAD", params: "int id", ...invalidFunction(), comment: "BAD: fake function" }),
    () => ({ method: "OrderLookup_BAD", params: "int id", ...invalidIndex("sales.Orders"), comment: "BAD: fake index" }),
    () => ({ method: "GetOrderDetail_BAD", params: "int id", ...multipleErrors("sales.Orders"), comment: "BAD: multi errors" }),
    () => ({ method: "GetBadTableCol_BAD", params: "int id", ...invalidTableAndColumn(), comment: "BAD: fake table+col" }),
  ],
  hr: [
    () => ({ method: "GetEmployee", params: "int id", ...validSelectWhere("hr.Employees", 6), comment: "Get employee" }),
    () => ({ method: "GetDepartments", params: "", ...validSelect("hr.Departments", 4), comment: "Departments" }),
    () => ({ method: "GetTimeEntries", params: "int empId", ...validSelectWhere("hr.TimeEntries", 4), comment: "Time entries" }),
    () => ({ method: "GetLeaveRequests", params: "int empId", ...validSelectWhere("hr.LeaveRequests", 5), comment: "Leave requests" }),
    () => ({ method: "GetReviews", params: "int empId", ...validSelectWhere("hr.PerformanceReviews", 4), comment: "Reviews" }),
    () => ({ method: "CreateEmployee", params: "Employee e", ...validInsert("hr.Employees"), comment: "Create employee" }),
    () => ({ method: "UpdateEmployee", params: "int id", ...validUpdate("hr.Employees"), comment: "Update employee" }),
    () => ({ method: "GetHeadcount", params: "int deptId", ...validExec("hr.sp_GetDepartmentHeadcount"), comment: "Headcount" }),
    () => ({ method: "GetTenure", params: "int id", ...validFuncCall("hr.fn_GetEmployeeTenure"), comment: "Tenure" }),
    () => ({ method: "GetEmpDept", params: "int id", ...validJoin("hr.Employees", "hr.Departments", "DepartmentId"), comment: "Employee + dept" }),
    // ERRORS:
    () => ({ method: "GetPayroll_BAD", params: "int empId", ...invalidTable(), comment: "BAD: fake table" }),
    () => ({ method: "GetEmpAddress_BAD", params: "int id", ...invalidColumn("hr.Employees"), comment: "BAD: fake column" }),
    () => ({ method: "GetDeptFloor_BAD", params: "int id", ...invalidColumn("hr.Departments"), comment: "BAD: fake column on dept" }),
    () => ({ method: "CalcVacation_BAD", params: "int id", ...invalidFunction(), comment: "BAD: fake function" }),
    () => ({ method: "GetEmpDetails_BAD", params: "int id", ...multipleErrors("hr.Employees"), comment: "BAD: multi errors" }),
    () => ({ method: "GetBadJoin_BAD", params: "int id", ...invalidColumnInJoin("hr.Employees", "hr.Departments", "DepartmentId"), comment: "BAD: bad col in join" }),
  ],
  msg: [
    () => ({ method: "GetConversation", params: "int id", ...validSelectWhere("msg.Conversations", 4), comment: "Get conversation" }),
    () => ({ method: "GetMessages", params: "int convId", ...validSelectWhere("msg.Messages", 5), comment: "Get messages" }),
    () => ({ method: "GetParticipants", params: "int convId", ...validSelectWhere("msg.ConversationParticipants", 4), comment: "Participants" }),
    () => ({ method: "GetAttachments", params: "int msgId", ...validSelectWhere("msg.Attachments", 4), comment: "Attachments" }),
    () => ({ method: "GetNotifications", params: "int userId", ...validSelectWhere("msg.Notifications", 5), comment: "Notifications" }),
    () => ({ method: "SendMessage", params: "Message m", ...validExec("msg.sp_SendMessage"), comment: "Send message" }),
    () => ({ method: "MarkRead", params: "int convId, int userId", ...validExec("msg.sp_MarkAsRead"), comment: "Mark read" }),
    () => ({ method: "GetUnread", params: "int userId", ...validFuncCall("msg.fn_GetUnreadCount"), comment: "Unread count" }),
    () => ({ method: "GetConvMessages", params: "int convId", ...validJoin("msg.Messages", "msg.Conversations", "ConversationId"), comment: "Messages + conv" }),
    // ERRORS:
    () => ({ method: "GetChannels_BAD", params: "int id", ...invalidTable(), comment: "BAD: fake table" }),
    () => ({ method: "GetMsgBody_BAD", params: "int id", ...invalidColumn("msg.Messages"), comment: "BAD: fake column" }),
    () => ({ method: "GetNotifPriority_BAD", params: "int id", ...invalidColumn("msg.Notifications"), comment: "BAD: fake column on notif" }),
    () => ({ method: "GetOnline_BAD", params: "int userId", ...invalidFunction(), comment: "BAD: fake function" }),
    () => ({ method: "GetMsgDetails_BAD", params: "int id", ...multipleErrors("msg.Messages"), comment: "BAD: multi errors" }),
  ],
};

// ── Main generation logic ──

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateAll() {
  // Clean output
  if (fs.existsSync(SRC)) fs.rmSync(SRC, { recursive: true });

  const domains = ["auth", "catalog", "sales", "hr", "msg"];
  const domainTables = {
    auth: ["auth.Users","auth.Roles","auth.UserRoles","auth.Permissions","auth.AuditLog","auth.Sessions"],
    catalog: ["catalog.Products","catalog.Categories","catalog.Brands","catalog.ProductVariants","catalog.ProductImages","catalog.ProductReviews","catalog.Inventory","catalog.Warehouses"],
    sales: ["sales.Orders","sales.OrderItems","sales.ShippingAddresses","sales.Payments","sales.Coupons","sales.Returns"],
    hr: ["hr.Employees","hr.Departments","hr.TimeEntries","hr.LeaveRequests","hr.PerformanceReviews"],
    msg: ["msg.Conversations","msg.Messages","msg.ConversationParticipants","msg.Attachments","msg.Notifications"],
  };

  for (const domain of domains) {
    const domainDir = path.join(SRC, domain);
    ensureDir(domainDir);

    const tables = domainTables[domain];
    const queryTemplates = DOMAIN_QUERIES[domain];

    // Generate C# repos — one per table (2-4 queries each)
    for (const table of tables) {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 2 + Math.floor(Math.random() * 3);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const code = genCsRepo(domain, table, queries);
      const fileName = getTableName(table) + "Repository.cs";
      const filePath = path.join(domainDir, fileName);
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }

    // Generate TS services — one per table
    for (const table of tables) {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 2 + Math.floor(Math.random() * 3);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const code = genTsService(domain, table, queries);
      const fileName = getTableName(table) + "Service.ts";
      const filePath = path.join(domainDir, fileName);
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }

    // Generate SQL scripts — one per domain, 4-6 queries
    {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 4 + Math.floor(Math.random() * 3);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const code = genSqlScript(domain, queries);
      const fileName = `${domain}_queries.sql`;
      const filePath = path.join(domainDir, fileName);
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }

    // Generate Python DAOs — one per table
    for (const table of tables) {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 2 + Math.floor(Math.random() * 2);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const code = genPyDao(domain, table, queries);
      const fileName = getTableName(table) + "Dao.py";
      const filePath = path.join(domainDir, fileName);
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }

    // Extra: generate many additional files for variety to hit 200+ total
    const extraCsNames = ["Controller", "Handler", "Middleware", "Validator", "Mapper", "Query", "Report", "Export", "Import", "Job"];
    const extraTsNames = ["Filter", "Resolver", "Analytics", "Sync", "Worker", "Monitor", "Cache", "Aggregator"];

    for (const suffix of extraCsNames) {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 2 + Math.floor(Math.random() * 2);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const fileName = capitalize(domain) + suffix + ".cs";
      const filePath = path.join(domainDir, fileName);
      const code = genCsRepo(domain, `${domain}.${capitalize(domain)}${suffix}`, queries);
      // Directly assign file to all errors produced by this batch
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }

    for (const suffix of extraTsNames) {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 2 + Math.floor(Math.random() * 2);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const fileName = capitalize(domain) + suffix + ".ts";
      const filePath = path.join(domainDir, fileName);
      const code = genTsService(domain, `${domain}.${capitalize(domain)}${suffix}`, queries);
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }

    // Extra SQL scripts per domain — stored procs, migrations, ad-hoc reports
    const extraSqlNames = [`${domain}_reports.sql`, `${domain}_migrations.sql`, `${domain}_adhoc.sql`];
    for (const sqlName of extraSqlNames) {
      const errsBefore = expectedErrors.length;
      const queries = [];
      const count = 3 + Math.floor(Math.random() * 3);
      const available = queryTemplates.map(fn => fn());
      const selected = pickN(available, Math.min(count, available.length));
      for (const q of selected) { queries.push(q); }
      const code = genSqlScript(domain, queries);
      const filePath = path.join(domainDir, sqlName);
      for (let i = errsBefore; i < expectedErrors.length; i++) {
        expectedErrors[i].file = path.resolve(filePath);
      }
      for (const err of expectedErrors) {
        if (err._fileKey === `${domain}/${sqlName}`) {
          err.file = path.resolve(filePath);
        }
      }
      fs.writeFileSync(filePath, code);
      fileCount++;
    }
  }

  // Write manifest — only errors that got a file assigned
  const manifest = expectedErrors
    .filter(e => e.file)
    .map(e => ({
      type: e.type,
      detail: e.errorDetail,
      file: e.file,
      line: e.line,
    }));

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ totalExpected: manifest.length, errors: manifest }, null, 2));

  console.log(`Generated ${fileCount} source files in ${SRC}`);
  console.log(`Expected ${manifest.length} errors documented in ${MANIFEST_PATH}`);
  console.log(`Error breakdown:`);
  const counts = {};
  for (const e of manifest) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(counts)) {
    console.log(`  ${type}: ${count}`);
  }
}

generateAll();
