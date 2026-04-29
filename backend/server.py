from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------- Models ----------
class InvoiceItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str = ""
    challan_no: str = ""
    items: str = ""
    hsn: str = ""
    lorry_no: str = ""
    qnty: float = 0
    rate: float = 0


class Invoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    bill_no: int
    order_no: str = ""
    customer_name: str
    customer_address: str = ""
    invoice_date: str
    items: List[InvoiceItem] = []
    cgst_rate: float = 2.5
    sgst_rate: float = 2.5
    payment_within_days: str = ""
    subtotal: float = 0
    cgst: float = 0
    sgst: float = 0
    round_off: float = 0
    total: float = 0
    amount_in_words: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class InvoiceCreate(BaseModel):
    bill_no: Optional[int] = None
    order_no: str = ""
    customer_name: str
    customer_address: str = ""
    invoice_date: str
    items: List[InvoiceItem] = []
    cgst_rate: float = 2.5
    sgst_rate: float = 2.5
    payment_within_days: str = ""
    subtotal: float = 0
    cgst: float = 0
    sgst: float = 0
    round_off: float = 0
    total: float = 0
    amount_in_words: str = ""


class Customer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    address: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CustomerCreate(BaseModel):
    name: str
    address: str = ""


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Bhagwati Enterprises Invoice API"}


@api_router.get("/next-bill-no")
async def get_next_bill_no():
    counter = await db.counters.find_one({"_id": "bill_no"})
    next_no = (counter["seq"] + 1) if counter else 1
    return {"next_bill_no": next_no}


@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(payload: InvoiceCreate):
    # Determine bill no (atomic increment)
    if payload.bill_no:
        bill_no = payload.bill_no
        await db.counters.update_one(
            {"_id": "bill_no"},
            {"$max": {"seq": bill_no}},
            upsert=True,
        )
    else:
        result = await db.counters.find_one_and_update(
            {"_id": "bill_no"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True,
        )
        bill_no = result["seq"]

    invoice = Invoice(bill_no=bill_no, **payload.model_dump(exclude={"bill_no"}))
    doc = invoice.model_dump()
    await db.invoices.insert_one(doc)

    # Save / upsert customer
    if payload.customer_name.strip():
        await db.customers.update_one(
            {"name": payload.customer_name.strip()},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "name": payload.customer_name.strip(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
                "$set": {"address": payload.customer_address or ""},
            },
            upsert=True,
        )
    return invoice


@api_router.get("/invoices", response_model=List[Invoice])
async def list_invoices(q: Optional[str] = None):
    query = {}
    if q:
        query = {
            "$or": [
                {"customer_name": {"$regex": q, "$options": "i"}},
                {"order_no": {"$regex": q, "$options": "i"}},
            ]
        }
    docs = await db.invoices.find(query, {"_id": 0}).sort("bill_no", -1).to_list(1000)
    return docs


@api_router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str):
    doc = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return doc


@api_router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, payload: InvoiceCreate):
    existing = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")

    update_data = payload.model_dump()
    if not update_data.get("bill_no"):
        update_data["bill_no"] = existing["bill_no"]
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.invoices.update_one({"id": invoice_id}, {"$set": update_data})

    if payload.customer_name.strip():
        await db.customers.update_one(
            {"name": payload.customer_name.strip()},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "name": payload.customer_name.strip(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
                "$set": {"address": payload.customer_address or ""},
            },
            upsert=True,
        )

    doc = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    return doc


@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str):
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"deleted": True}


@api_router.get("/customers", response_model=List[Customer])
async def list_customers():
    docs = await db.customers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return docs


@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    existing = await db.customers.find_one({"name": name}, {"_id": 0})
    if existing:
        return existing
    cust = Customer(name=name, address=payload.address or "")
    await db.customers.insert_one(cust.model_dump())
    return cust


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
