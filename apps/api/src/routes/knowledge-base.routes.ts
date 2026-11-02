import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/knowledge-base/categories
 */
router.get('/categories', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({
      where: { organizationId: req.organizationId },
      include: {
        _count: {
          select: { articles: true },
        },
      },
      orderBy: { orderIndex: 'asc' },
    });

    res.json({ categories });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/knowledge-base/categories
 */
router.post('/categories', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, slug, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Bad Request', message: 'Category name is required' });
      return;
    }

    const catSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const category = await prisma.category.create({
      data: {
        organizationId: req.organizationId!,
        name,
        slug: catSlug,
        description,
      },
    });

    res.status(201).json({ category, message: 'Category created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/v1/knowledge-base/articles
 */
router.get('/articles', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { categoryId, status, search } = req.query;
    const organizationId = req.organizationId!;

    const whereClause: any = { organizationId };
    if (categoryId) whereClause.categoryId = String(categoryId);
    if (status) whereClause.status = String(status).toUpperCase();
    if (search && String(search).trim()) {
      const q = String(search).trim();
      whereClause.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
      ];
    }

    const articles = await prisma.article.findMany({
      where: whereClause,
      include: {
        category: true,
        author: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ articles });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/knowledge-base/articles
 */
router.post('/articles', requireRoles(['OWNER', 'ADMIN', 'AGENT']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { categoryId, title, slug, content, status } = req.body;
    const organizationId = req.organizationId!;

    if (!categoryId || !title || !content) {
      res.status(400).json({ error: 'Bad Request', message: 'Category, title, and content are required' });
      return;
    }

    // Tenant Isolation Check: Verify category belongs to organization
    const category = await prisma.category.findFirst({
      where: { id: String(categoryId), organizationId },
    });
    if (!category) {
      res.status(400).json({ error: 'Bad Request', message: 'Category does not belong to your organization' });
      return;
    }

    const articleSlug = slug || title.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const article = await prisma.article.create({
      data: {
        organizationId,
        categoryId,
        authorId: req.user!.id,
        title,
        slug: articleSlug,
        content,
        status: status ? status.toUpperCase() : 'PUBLISHED',
      },
      include: {
        category: true,
      },
    });

    res.status(201).json({ article, message: 'Article created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
