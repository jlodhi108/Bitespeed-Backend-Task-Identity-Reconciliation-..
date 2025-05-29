import { Router, Request, Response } from "express";
import { identify } from "../services/identifyService";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { email = null, phoneNumber = null } = req.body ?? {};
  if (!email && !phoneNumber) {
    return res.status(400).json({ error: "email or phoneNumber required" });
  }

  try {
    const contactPayload = await identify(email, phoneNumber);
    res.json({ contact: contactPayload });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
