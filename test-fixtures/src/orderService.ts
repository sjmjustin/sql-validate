import { Database } from './database';

export class OrderService {
  constructor(private db: Database) {}

  // GOOD: valid query
  async getOrder(orderId: number) {
    return this.db.query(`
      SELECT o.Id, o.UserId, o.OrderDate, o.TotalAmount, o.Status
      FROM dbo.Orders o
      WHERE o.Id = ${orderId}
    `);
  }

  // BAD: "dbo.Invoices" table does not exist
  async getInvoice(orderId: number) {
    return this.db.query(`
      SELECT i.Id, i.InvoiceNumber, i.Amount
      FROM dbo.Invoices i
      WHERE i.OrderId = ${orderId}
    `);
  }

  // BAD: "o.ShipDate" does not exist on Orders (should be OrderDate or ShippingAddress)
  async getShippingInfo(orderId: number) {
    return this.db.query(`
      SELECT o.Id, o.ShipDate, o.ShippingAddress
      FROM dbo.Orders o
      WHERE o.Id = ${orderId}
    `);
  }

  // BAD: calling fn_CalculateDiscount which does not exist
  async getDiscountedTotal(orderId: number) {
    return this.db.query(`
      SELECT dbo.fn_CalculateDiscount(${orderId}) AS DiscountedTotal
    `);
  }
}
