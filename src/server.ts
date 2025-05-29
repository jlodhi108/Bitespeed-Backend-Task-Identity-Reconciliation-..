import express, { Request, Response } from "express";
import identifyRouter from "./routes/identify";

const app = express();
app.use(express.json());

app.use("/identify", identifyRouter);

// 404 fallback
app.use((_req, res) => res.status(404).json({ message: "Not found" }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`Bitespeed Identity service running on :${PORT}`)
);
