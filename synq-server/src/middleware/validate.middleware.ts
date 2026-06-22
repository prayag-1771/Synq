import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          message: 'Validation failed',
          errors: (error.errors || error.issues || []).map((e: any) => ({
            field: e.path ? e.path.join('.') : 'unknown',
            message: e.message,
          })),
        });
      } else {
        next(error);
      }
    }
  };
};
