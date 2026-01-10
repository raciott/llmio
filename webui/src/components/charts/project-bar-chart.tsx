"use client"

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ProjectCount } from "@/lib/api"

const predefinedColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
]

const generateChartConfig = (data: ProjectCount[]) => {
  const config: ChartConfig = {
    calls: {
      label: "调用次数",
    },
  }

  data.forEach((item, index) => {
    config[item.project] = {
      label: item.project,
      color: predefinedColors[index % predefinedColors.length],
    }
  })

  return config
}

const generateChartData = (data: ProjectCount[]) => {
  return data.map((item, index) => ({
    project: item.project,
    calls: item.calls,
    fill: predefinedColors[index % predefinedColors.length],
  }))
}

interface ProjectRankingChartProps {
  data: ProjectCount[]
  embedded?: boolean
}

export function ProjectRankingChart({ data, embedded = false }: ProjectRankingChartProps) {
  const chartData = generateChartData(data)
  const chartConfig = generateChartConfig(data)

  const chart = (
    <ChartContainer config={chartConfig} className="aspect-auto h-[350px] w-full">
      <BarChart
        accessibilityLayer
        data={chartData}
        barSize={32}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="project"
          tickLine={false}
          axisLine={false}
          tickMargin={16}
          interval={0}
          tickFormatter={(value) => String(value)}
        />
        <YAxis
          dataKey="calls"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => Number(value).toLocaleString()}
          width={60}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="line" hideLabel />}
        />
        <Bar
          dataKey="calls"
          fill="var(--color-calls)"
          radius={[8, 8, 0, 0]}
        >
          <LabelList
            dataKey="calls"
            position="top"
            offset={12}
            className="fill-foreground font-medium"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )

  if (embedded) {
    return chart
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>项目调用排行</CardTitle>
      </CardHeader>
      <CardContent>{chart}</CardContent>
    </Card>
  )
}
